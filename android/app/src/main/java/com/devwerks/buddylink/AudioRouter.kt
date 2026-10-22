package com.devwerks.buddylink

import android.content.AttributionSource
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.IBinder
import org.lsposed.hiddenapibypass.HiddenApiBypass
import rikka.shizuku.Shizuku
import rikka.shizuku.ShizukuBinderWrapper
import rikka.shizuku.SystemServiceHelper

/**
 * Per-app audio routing (experimental).
 *
 * Android only lets holders of MODIFY_AUDIO_ROUTING register an AudioPolicy that pins an
 * app's playback to a device. The shell user has that permission, so we borrow it through
 * Shizuku: while registering, AudioManager's cached service is swapped for one whose binder
 * calls run as shell. The policy stays alive only as long as this process does.
 */
object AudioRouter {
    private const val RULE_MATCH_UID = 0x1 shl 2
    private const val ROUTE_FLAG_RENDER = 0x1
    private const val SHIZUKU_CODE = 4711

    private var policy: Any? = null
    var routes: Map<Int, AudioDeviceInfo> = emptyMap()
        private set

    fun shizukuRunning() = try { Shizuku.pingBinder() } catch (_: Throwable) { false }

    fun shizukuGranted() = shizukuRunning() && !Shizuku.isPreV11() &&
        Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED

    fun requestShizuku() { if (shizukuRunning()) Shizuku.requestPermission(SHIZUKU_CODE) }

    fun outputs(ctx: Context): List<AudioDeviceInfo> =
        ctx.getSystemService(AudioManager::class.java).getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            .filter { it.type in setOf(
                AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_BLE_SPEAKER,
            ) }

    fun label(d: AudioDeviceInfo) = when (d.type) {
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "Phone speaker"
        else -> d.productName?.toString()?.ifBlank { null } ?: "Device ${d.id}"
    }

    /** Replaces all routes with [newRoutes] (uid → device). Returns null on success, else the error. */
    fun apply(ctx: Context, newRoutes: Map<Int, AudioDeviceInfo>): String? {
        if (!shizukuGranted()) return "Shizuku is not running or not allowed"
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) HiddenApiBypass.addHiddenApiExemptions("L")
            val am = ctx.getSystemService(AudioManager::class.java)
            asShell {
                policy?.let { unregister(am, it) }
                policy = null
                routes = emptyMap()
                if (newRoutes.isNotEmpty()) {
                    val p = buildPolicy(ctx, newRoutes)
                    val res = AudioManager::class.java.getMethod("registerAudioPolicy", Class.forName("android.media.audiopolicy.AudioPolicy"))
                        .invoke(am, p) as Int
                    if (res != 0) throw IllegalStateException("registerAudioPolicy returned $res")
                    policy = p
                    routes = newRoutes
                }
            }
            null
        } catch (t: Throwable) {
            val root = generateSequence(t) { it.cause }.last()
            "${root.javaClass.simpleName}: ${root.message}"
        }
    }

    private fun buildPolicy(ctx: Context, map: Map<Int, AudioDeviceInfo>): Any {
        val ruleB = Class.forName("android.media.audiopolicy.AudioMixingRule\$Builder")
        val mixB = Class.forName("android.media.audiopolicy.AudioMix\$Builder")
        val mixC = Class.forName("android.media.audiopolicy.AudioMix")
        val ruleC = Class.forName("android.media.audiopolicy.AudioMixingRule")
        val policyB = Class.forName("android.media.audiopolicy.AudioPolicy\$Builder")
        val builder = policyB.getConstructor(Context::class.java).newInstance(shellContext(ctx))
        for ((uid, device) in map) {
            val rb = ruleB.getConstructor().newInstance()
            ruleB.getMethod("addMixRule", Int::class.java, Any::class.java).invoke(rb, RULE_MATCH_UID, uid)
            val rule = ruleB.getMethod("build").invoke(rb)
            val mb = mixB.getConstructor(ruleC).newInstance(rule)
            mixB.getMethod("setRouteFlags", Int::class.java).invoke(mb, ROUTE_FLAG_RENDER)
            mixB.getMethod("setDevice", AudioDeviceInfo::class.java).invoke(mb, device)
            policyB.getMethod("addMix", mixC).invoke(builder, mixB.getMethod("build").invoke(mb))
        }
        val policy = policyB.getMethod("build").invoke(builder)!!
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) patchAttribution(policy)
        return policy
    }

    // Android 14+ sends the policy's AttributionSource along and checks it against the calling uid,
    // which is shell when we go through Shizuku, so the policy has to claim to be shell as well.
    private const val SHELL_UID = 2000
    private const val SHELL_PACKAGE = "com.android.shell"

    private fun shellAttribution(): AttributionSource =
        AttributionSource.Builder(SHELL_UID).setPackageName(SHELL_PACKAGE).build()

    private fun shellContext(ctx: Context): Context =
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) ctx
        else object : ContextWrapper(ctx) {
            override fun getAttributionSource() = shellAttribution()
            override fun getOpPackageName() = SHELL_PACKAGE
        }

    /** Replaces any AttributionSource the policy (or its config) cached from the app context. */
    private fun patchAttribution(target: Any, depth: Int = 0) {
        var c: Class<*>? = target.javaClass
        while (c != null && c != Any::class.java) {
            for (f in c.declaredFields) {
                if (java.lang.reflect.Modifier.isStatic(f.modifiers)) continue
                f.isAccessible = true
                when {
                    f.type == AttributionSource::class.java -> f.set(target, shellAttribution())
                    depth == 0 && f.type.name == "android.media.audiopolicy.AudioPolicyConfig" ->
                        f.get(target)?.let { patchAttribution(it, 1) }
                }
            }
            c = c.superclass
        }
    }

    private fun unregister(am: AudioManager, p: Any) {
        val pc = Class.forName("android.media.audiopolicy.AudioPolicy")
        val m = runCatching { AudioManager::class.java.getMethod("unregisterAudioPolicy", pc) }
            .getOrElse { AudioManager::class.java.getMethod("unregisterAudioPolicyAsync", pc) }
        m.invoke(am, p)
    }

    /** Runs [block] with AudioManager talking to AudioService as the shell user. */
    private fun asShell(block: () -> Unit) {
        val field = AudioManager::class.java.getDeclaredField("sService").apply { isAccessible = true }
        val original = field.get(null)
        val binder: IBinder = SystemServiceHelper.getSystemService(Context.AUDIO_SERVICE)
        val shell = Class.forName("android.media.IAudioService\$Stub")
            .getMethod("asInterface", IBinder::class.java).invoke(null, ShizukuBinderWrapper(binder))
        field.set(null, shell)
        try { block() } finally { field.set(null, original) }
    }
}
