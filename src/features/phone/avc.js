// The codec string WebCodecs needs ("avc1.PPCCLL") from the SPS in an
// Annex B H.264 packet; null when the packet has no SPS.
export function avcCodecString(bytes) {
  for (let i = 0; i + 6 < bytes.length; i++) {
    if (bytes[i] !== 0 || bytes[i + 1] !== 0 || bytes[i + 2] !== 1) continue;
    if ((bytes[i + 3] & 0x1f) === 7) {
      return `avc1.${[bytes[i + 4], bytes[i + 5], bytes[i + 6]].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return null;
}
