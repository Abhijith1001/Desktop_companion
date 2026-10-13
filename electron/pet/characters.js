// Pet characters. Each `svg` is drawn in a 160x130 viewBox with feet at y≈116,
// facing right. Shared hooks used by the animations in pet.html:
//   .leg / .leg.b   legs (".b" swings in opposite phase)
//   .arm / .arm.b   arms (upright characters only)
//   #tail, #head, #eye-open, #eye-closed, #tongue
// `upright: true` switches sit/sleep poses to the two-legged versions.
window.CHARACTERS = {
  dog: {
    name: 'Cute Dog',
    upright: false,
    svg: `
      <path id="tail" d="M30 62 Q10 50 16 30" stroke="#d98a3a" stroke-width="10" fill="none" stroke-linecap="round"/>
      <rect class="leg back b"  x="40" y="82" width="12" height="32" rx="6" fill="#c97a2e"/>
      <rect class="leg front"   x="92" y="82" width="12" height="32" rx="6" fill="#c97a2e"/>
      <ellipse cx="70" cy="74" rx="46" ry="26" fill="#e8994a"/>
      <ellipse cx="74" cy="84" rx="30" ry="12" fill="#f6dcb8"/>
      <rect class="leg back"    x="28" y="84" width="13" height="32" rx="6.5" fill="#e8994a"/>
      <rect class="leg front b" x="102" y="84" width="13" height="32" rx="6.5" fill="#e8994a"/>
      <path d="M98 54 Q104 70 116 66" stroke="#e0443e" stroke-width="6" fill="none" stroke-linecap="round"/>
      <circle cx="106" cy="70" r="4" fill="#ffd34d" stroke="#b8901c" stroke-width="1"/>
      <g id="head">
        <path d="M101 32 L106 8 L120 26 Z" fill="#c97a2e"/>
        <circle cx="118" cy="44" r="24" fill="#e8994a"/>
        <path d="M112 26 L123 3 L134 27 Z" fill="#c97a2e"/>
        <path d="M117 23 L123 10 L129 24 Z" fill="#f6b98a"/>
        <ellipse cx="136" cy="54" rx="16" ry="11" fill="#f6dcb8"/>
        <ellipse cx="150" cy="50" rx="5" ry="4" fill="#3a2a20"/>
        <g id="eye-open"><circle cx="126" cy="40" r="4" fill="#2b1d14"/><circle cx="127.5" cy="38.5" r="1.3" fill="#fff"/></g>
        <path id="eye-closed" d="M121 41 Q126 45 131 41" stroke="#2b1d14" stroke-width="2.5" fill="none" stroke-linecap="round"/>
        <ellipse cx="117" cy="53" rx="5" ry="3" fill="#ff9d8a" opacity=".6"/>
        <path id="tongue" d="M139 61 Q141 73 147 62 Z" fill="#ff6f7d"/>
        <path d="M138 60 Q142 64 147 60" stroke="#3a2a20" stroke-width="2" fill="none" stroke-linecap="round"/>
      </g>`,
  },

  tom: {
    name: 'Gray Cartoon Cat',
    upright: true,
    svg: `
    <!-- Tail (behind the body) -->
    <path id="tail" d="M64 94 Q102 104 108 78 Q111 64 101 66"
      stroke="#737985" stroke-width="8" fill="none" stroke-linecap="round"/>

    <!-- Legs with white feet -->
    <g class="leg"><rect x="56" y="88" width="13" height="24" rx="6" fill="#626975"/>
      <ellipse cx="60" cy="114" rx="11" ry="5" fill="#f4f1ee" stroke="#292d33" stroke-width="1"/></g>
    <g class="leg b"><rect x="72" y="88" width="13" height="24" rx="6" fill="#737985"/>
      <ellipse cx="81" cy="114" rx="11" ry="5" fill="#f4f1ee" stroke="#292d33" stroke-width="1"/></g>

    <!-- Back arm -->
    <g class="arm b"><rect x="86" y="62" width="10" height="26" rx="5" fill="#626975"/>
      <circle cx="91" cy="90" r="6" fill="#f4f1ee" stroke="#292d33" stroke-width="1"/></g>

    <!-- Upright body with white belly -->
    <ellipse cx="70" cy="78" rx="19" ry="22" fill="#737985" stroke="#292d33" stroke-width="1.5"/>
    <ellipse cx="70" cy="82" rx="12" ry="16" fill="#e8e5e2"/>

    <!-- Front arm -->
    <g class="arm"><rect x="44" y="62" width="10" height="26" rx="5" fill="#737985"/>
      <circle cx="49" cy="90" r="6" fill="#f4f1ee" stroke="#292d33" stroke-width="1"/></g>

    <!-- Head (shrunk to sit on the upright body) -->
    <g id="head"><g transform="translate(70 70) scale(.72) translate(-70 -72)">
      <!-- Ears -->
      <path d="M48 31 L29 3 L28 42 Z" fill="#626975"
        stroke="#292d33" stroke-width="2"/>
      <path d="M34 30 L30 12 L43 32 Z" fill="#f39b9b"/>

      <path d="M91 31 L112 3 L112 43 Z" fill="#626975"
        stroke="#292d33" stroke-width="2"/>
      <path d="M101 30 L109 12 L98 33 Z" fill="#f39b9b"/>

      <!-- Head shape -->
      <path d="M31 31
        Q35 13 57 17
        Q70 9 83 17
        Q106 13 110 35
        L106 54
        Q99 72 70 72
        Q41 72 34 54 Z"
        fill="#737985" stroke="#292d33" stroke-width="2"/>

      <!-- Forehead markings -->
      <path d="M57 18 L65 28 L69 17
        M73 17 L78 28 L85 18"
        fill="none" stroke="#454b55" stroke-width="3"
        stroke-linecap="round"/>

      <!-- Eyes -->
      <g id="eye-open">
        <ellipse cx="57" cy="39" rx="8" ry="12" fill="#f8df45"/>
        <ellipse cx="83" cy="39" rx="8" ry="12" fill="#f8df45"/>
        <ellipse cx="59" cy="40" rx="3" ry="7" fill="#253322"/>
        <ellipse cx="81" cy="40" rx="3" ry="7" fill="#253322"/>
      </g>
      <path id="eye-closed" d="M50 41 Q57 46 64 41 M76 41 Q83 46 90 41"
        fill="none" stroke="#292d33" stroke-width="2.5" stroke-linecap="round"/>

      <!-- Muzzle -->
      <ellipse cx="59" cy="53" rx="15" ry="10" fill="#f4f1ee"/>
      <ellipse cx="81" cy="53" rx="15" ry="10" fill="#f4f1ee"/>

      <!-- Nose -->
      <path d="M65 48 Q70 44 75 48 L70 53 Z" fill="#302a2b"/>

      <!-- Mouth -->
      <path d="M70 53 L70 59
        Q61 67 54 59
        M70 59 Q79 67 86 59"
        fill="none" stroke="#302a2b" stroke-width="2"
        stroke-linecap="round"/>

      <path id="tongue" d="M66 61 Q70 70 74 61 Z" fill="#ff6f7d"/>

      <!-- Whiskers -->
      <path d="M45 52 L24 47 M45 57 L22 60
        M95 52 L116 47 M95 57 L118 60"
        fill="none" stroke="#292d33" stroke-width="1.5"
        stroke-linecap="round"/>
    </g></g>`,
  },

  cat: {
    name: 'Tom-Style Cat',
    upright: false,
    svg: `
    <!-- Tail -->
    <path id="tail" d="M32 67 Q8 60 17 38 Q22 26 12 23"
      stroke="#707780" stroke-width="9" fill="none"
      stroke-linecap="round"/>

    <!-- Back legs -->
    <rect class="leg back b" x="39" y="83" width="13" height="31"
      rx="6.5" fill="#707780"/>

    <!-- Body -->
    <ellipse cx="69" cy="73" rx="43" ry="25" fill="#89929e"/>
    <ellipse cx="73" cy="81" rx="28" ry="13" fill="#e9e9e5"/>

    <!-- Front legs -->
    <rect class="leg front" x="91" y="83" width="13" height="31"
      rx="6.5" fill="#89929e"/>

    <!-- Paws -->
    <ellipse cx="45" cy="114" rx="10" ry="4" fill="#d6d9dd"/>
    <ellipse cx="98" cy="114" rx="10" ry="4" fill="#d6d9dd"/>

    <!-- Head -->
    <g id="head">

      <!-- Ears -->
      <path d="M91 32 L91 4 L113 23 Z" fill="#707780"/>
      <path d="M96 23 L96 11 L106 23 Z" fill="#e99da9"/>

      <path d="M125 22 L145 3 L146 32 Z" fill="#707780"/>
      <path d="M132 22 L142 12 L141 25 Z" fill="#e99da9"/>

      <!-- Head shape -->
      <ellipse cx="119" cy="43" rx="32" ry="28" fill="#89929e"/>

      <!-- Cheeks and muzzle -->
      <ellipse cx="119" cy="58" rx="24" ry="13" fill="#e9e9e5"/>
      <ellipse cx="107" cy="55" rx="13" ry="10" fill="#f4f1eb"/>
      <ellipse cx="132" cy="55" rx="13" ry="10" fill="#f4f1eb"/>

      <!-- Nose -->
      <path d="M115 51 Q120 47 125 51 L120 57 Z" fill="#e889a0"/>

      <!-- Mouth -->
      <path d="M120 57 L120 62 M120 62 Q113 68 108 62
               M120 62 Q127 68 132 62"
        stroke="#454a52" stroke-width="2" fill="none"
        stroke-linecap="round"/>

      <!-- Eyes -->
      <g id="eye-open">
        <ellipse cx="106" cy="39" rx="8" ry="10" fill="#d8e85b"/>
        <ellipse cx="108" cy="40" rx="3" ry="7" fill="#242a2f"/>
        <circle cx="109" cy="36" r="2" fill="#ffffff"/>

        <ellipse cx="132" cy="39" rx="8" ry="10" fill="#d8e85b"/>
        <ellipse cx="130" cy="40" rx="3" ry="7" fill="#242a2f"/>
        <circle cx="131" cy="36" r="2" fill="#ffffff"/>
      </g>

      <!-- Closed eyes for blinking -->
      <g id="eye-closed">
        <path d="M98 40 Q106 45 114 40
                 M124 40 Q132 45 140 40"
          stroke="#454a52" stroke-width="2.5"
          fill="none" stroke-linecap="round"/>
      </g>

      <!-- Whiskers -->
      <g stroke="#555c65" stroke-width="1.5" fill="none"
         stroke-linecap="round">
        <path d="M99 55 L79 50"/>
        <path d="M99 60 L78 61"/>
        <path d="M139 55 L159 50"/>
        <path d="M139 60 L160 61"/>
      </g>

      <!-- Eyebrows -->
      <path d="M98 26 Q106 22 114 27"
        stroke="#626b76" stroke-width="2.5"
        fill="none" stroke-linecap="round"/>
      <path d="M125 27 Q133 22 140 26"
        stroke="#626b76" stroke-width="2.5"
        fill="none" stroke-linecap="round"/>

    </g>
  `,
  },

  hero: {
    name: 'Hero Kid',
    upright: true,
    svg: `
      <g class="leg"><rect x="68" y="78" width="11" height="34" rx="4" fill="#3c8d3a"/><rect x="66" y="108" width="15" height="8" rx="4" fill="#2a2a2a"/></g>
      <g class="leg b"><rect x="81" y="78" width="11" height="34" rx="4" fill="#3c8d3a"/><rect x="79" y="108" width="15" height="8" rx="4" fill="#2a2a2a"/></g>
      <g class="arm b"><rect x="95" y="48" width="9" height="16" rx="4" fill="#222"/><rect x="95.5" y="62" width="8" height="16" rx="4" fill="#f2c9a0"/><rect x="94" y="68" width="11" height="6" rx="2" fill="#2a2a2a"/><circle cx="99.5" cy="71" r="2.5" fill="#6bf03a"/></g>
      <rect x="64" y="46" width="32" height="36" rx="7" fill="#222"/>
      <rect x="77" y="46" width="6" height="36" fill="#f5f5f5"/>
      <g class="arm"><rect x="56" y="48" width="9" height="16" rx="4" fill="#222"/><rect x="56.5" y="62" width="8" height="16" rx="4" fill="#f2c9a0"/></g>
      <g id="head">
        <rect x="75" y="40" width="10" height="8" fill="#f2c9a0"/>
        <circle cx="80" cy="28" r="17" fill="#f2c9a0"/>
        <path d="M62 30 Q58 6 80 9 Q103 6 98 30 L93 20 L88 25 L83 16 L77 24 L71 18 L67 27 Z" fill="#6b3f1f"/>
        <g id="eye-open"><circle cx="75" cy="30" r="2.8" fill="#2f8f2f"/><circle cx="87" cy="30" r="2.8" fill="#2f8f2f"/></g>
        <path id="eye-closed" d="M72 30 Q75 33 78 30 M84 30 Q87 33 90 30" stroke="#3a2a20" stroke-width="2" fill="none" stroke-linecap="round"/>
        <ellipse id="tongue" cx="81" cy="38" rx="3.5" ry="2.8" fill="#9c2f3a"/>
        <path d="M76 36 Q81 40 86 36" stroke="#3a2a20" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      </g>`,
  },

  ranger: {
    name: 'Ranger Hero',
    upright: true,
    svg: `
      <g class="leg"><rect x="68" y="78" width="11" height="34" rx="4" fill="#d6262b"/><rect x="66" y="104" width="15" height="12" rx="4" fill="#f5f5f5"/></g>
      <g class="leg b"><rect x="81" y="78" width="11" height="34" rx="4" fill="#d6262b"/><rect x="79" y="104" width="15" height="12" rx="4" fill="#f5f5f5"/></g>
      <g class="arm b"><rect x="95" y="48" width="9" height="30" rx="4" fill="#d6262b"/><rect x="95" y="68" width="9" height="10" rx="4" fill="#f5f5f5"/></g>
      <rect x="64" y="46" width="32" height="36" rx="7" fill="#d6262b"/>
      <path d="M66 50 L80 64 L94 50 L94 56 L80 70 L66 56 Z" fill="#f5f5f5"/>
      <rect x="64" y="74" width="32" height="5" fill="#222"/>
      <rect x="77" y="73" width="6" height="7" rx="1" fill="#e6c34a"/>
      <g class="arm"><rect x="56" y="48" width="9" height="30" rx="4" fill="#d6262b"/><rect x="56" y="68" width="9" height="10" rx="4" fill="#f5f5f5"/></g>
      <g id="head">
        <rect x="75" y="40" width="10" height="8" fill="#222"/>
        <path d="M63 30 Q63 10 80 10 Q97 10 97 30 Q97 44 80 45 Q63 44 63 30 Z" fill="#d6262b"/>
        <path d="M67 24 H93 V30 L86 36 V42 H74 V36 L67 30 Z" fill="#1c1c22"/>
        <path d="M70 14 Q80 10 90 14" stroke="#fff" stroke-width="2" fill="none" opacity=".5"/>
        <g id="eye-open"><rect x="70" y="26" width="8" height="2" rx="1" fill="#fff" opacity=".35"/></g>
        <g id="eye-closed"></g>
        <g id="tongue"></g>
      </g>`,
  },
};

// Full SVG for a character, wrapped in the groups buddy.css animates.
window.buddyMarkup = function buddyMarkup(id) {
  const c = window.CHARACTERS[id] || window.CHARACTERS.dog;
  return `<svg viewBox="0 0 160 130" aria-hidden="true">
    <ellipse cx="78" cy="122" rx="52" ry="5" fill="#000" opacity=".15"/>
    <g class="jump"><g class="body-g">${c.svg}</g></g>
    <g class="zzz" font-family="Segoe UI, sans-serif" font-weight="700" fill="#6b7fd7">
      <text x="140" y="20" font-size="14">z</text><text x="146" y="12" font-size="11">z</text><text x="150" y="6" font-size="9">z</text>
    </g>
    <g class="fx" font-family="Segoe UI, sans-serif" font-weight="900">
      <text class="fx-bang" x="132" y="16" font-size="22" fill="#e0443e" stroke="#fff" stroke-width="1">!</text>
      <text class="fx-huh" x="130" y="16" font-size="20" fill="#6b7fd7" stroke="#fff" stroke-width="1">?</text>
      <path class="fx-sweat" d="M146 22 Q140 32 146 35 Q152 32 146 22 Z" fill="#7cc4f2" stroke="#3a8cc4" stroke-width="1"/>
      <g class="fx-lines" stroke="#292d33" stroke-width="2" stroke-linecap="round">
        <path d="M4 60 L22 60"/><path d="M0 74 L20 74"/><path d="M6 88 L22 88"/>
      </g>
    </g>
  </svg>`;
};
