/**
 * SuperLexicon Interactive Game Onboarding, Contextual "Next Step" Coach & 4-Tab Field Manual
 *
 * Shared across all 3 Subnet 1 Halt-Free Subroutine games:
 *  - `battleship`  ("Phantom Fleet: 100-Player Naval Warfare")
 *  - `cipher-noir` ("Cipher Noir: Syndicate Sabotage")
 *  - `hegemony`    ("Fractured Hegemony: Simultaneous Sovereign Conquest")
 *
 * Provides:
 *  1. First-visit 3-Step Quick-Start Welcome Card (`localStorage['slx_game_guide_seen_<id>_v1']`)
 *     with one-click primary start action + link to the full 4-Tab Field Manual.
 *  2. Always-visible `📖 How to Play` header button opening the 4-Tab Field Manual modal:
 *       - Tab 1: 🚀 Quick-Start (30-Second Overview & Win Condition)
 *       - Tab 2: 🎮 Controls, Turn Flow & Visual Board Legend
 *       - Tab 3: 📊 Unit / Dossier / Territory Reference & Pro Strategy
 *       - Tab 4: ⛓️ How It Works On-Chain ($0 Gas Subnet 1 Architecture)
 *  3. Live State-Driven `🧭 NEXT STEP` Contextual Coach Bar (`guide.updateCoach(...)`)
 *     that adapts dynamically as the player progresses from spectating -> joining -> playing -> winning.
 */

const GUIDE_VERSION = 'v1';

function storageKeyFor(gameId) {
  return `slx_game_guide_seen_${gameId}_${GUIDE_VERSION}`;
}

export function hasSeenGameWelcome(gameId) {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(storageKeyFor(gameId)) === '1';
  } catch (_) {
    return false;
  }
}

export function markGameWelcomeSeen(gameId) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKeyFor(gameId), '1');
  } catch (_) {
    // Ignore private-mode storage errors
  }
}

// ---------------------------------------------------------------------------
// Complete 4-Tab Field Manual Content for All 3 Games
// ---------------------------------------------------------------------------

const GAME_MANUALS = {
  battleship: {
    icon: '⚓',
    title: 'Phantom Fleet — Naval Field Manual',
    accent: '#38bdf8',
    tagline:
      'Real-time 100-player Red vs. Blue naval tactics & ship-upgrade economy — like classic Battleship reimagined on an open ocean with visible range rings, instant 100% square hits, and $0 gas.',
    welcomePrimaryLabel: '⚓ Got It — Pick Team & Deploy Fleet',
    quickSteps: [
      {
        num: '1',
        title: 'Commission Your 3-Ship Squadron (1,000 CR)',
        body: 'Pick Red Armada or Blue Coalition (teams auto-balance within 1 captain) and spend your free 1,000 CR budget on up to 3 starter ships — all 3 deploy onto the ocean in a single ~4s block.',
      },
      {
        num: '2',
        title: 'Select a Ship & Sail Inside the Green Circle',
        body: 'Click Ship [1], [2], or [3] (or press 1/2/3). In Green Move Mode, click any water tile inside your ship’s Green Speed Circle to sail there instantly (click ↻ Rotate or press R to turn 90°).',
      },
      {
        num: '3',
        title: 'Switch to Fire Mode & Destroy Enemy Hull Squares',
        body: 'Click 🎯 Fire Mode (or hold Shift / Space) and click inside your Red Gun Ring! Every hit destroys 100% of that hull square (+120 CR) and sinking all squares of an enemy ship awards a huge Kill Bounty.',
      },
    ],
    tabs: {
      quickstart: `
        <div class="slx-gg-hero">
          <div class="slx-gg-hero-title">🎯 Goal of Phantom Fleet</div>
          <p>
            Command a squadron of up to <strong>3 warships</strong> alongside your Red or Blue teammates on a dynamically scaling ocean grid.
            Earn <strong>Credits (<code>CR</code>)</strong> and <strong>Leaderboard Points</strong> by hitting enemy hull squares and sinking rival ships, then reinvest your Credits into <strong>heavier hulls (Frigates, Cruisers, Dreadnoughts), multi-tile weapons, hull repairs, and engine upgrades</strong>!
          </p>
        </div>
        <div class="slx-gg-steps-grid">
          <div class="slx-gg-step-card">
            <span class="slx-gg-step-num">STEP 1</span>
            <h4>Deploy With 1,000 CR</h4>
            <p>Click <strong>⚓ Squadron / Join</strong> to choose Red or Blue and pick 1–3 starter vessels. Keeping <code>150–250 CR</code> in reserve lets you repair or upgrade right away!</p>
          </div>
          <div class="slx-gg-step-card">
            <span class="slx-gg-step-num">STEP 2</span>
            <h4>Sail &amp; Flank (Green Mode)</h4>
            <p>In <strong>🟢 Move Mode</strong>, click anywhere inside your selected ship&rsquo;s <strong>Green Range Circle</strong>. Your ship teleports to the new coordinates as soon as the block confirms (~4s).</p>
          </div>
          <div class="slx-gg-step-card">
            <span class="slx-gg-step-num">STEP 3</span>
            <h4>Aim &amp; Sink (Red Mode)</h4>
            <p>Click <strong>🎯 Fire Mode</strong> (or hold <kbd>Shift</kbd>/<kbd>Space</kbd>) to reveal your <strong>Red Gun Ring</strong>. Click an enemy ship to destroy hull squares (<code>+120 CR</code> &amp; <code>+100 pts</code> per square)!</p>
          </div>
        </div>
        <div class="slx-gg-tip-box">
          <strong>⚓ Taking a Break? Return to Naval Base!</strong> Click <strong>⚓ Return All to Base</strong> anytime to safely drydock your fleet in your team&rsquo;s fortified Harbor (Red NW / Blue SE). Inside your harbor it&rsquo;s instant; from open sea it starts a <strong>3-block (~13s) Out-of-Combat Tow</strong> (cancelled if you&rsquo;re actively under fire, so nobody can abuse it to dodge incoming shots!). When you come back, click <strong>🚀 Sortie All</strong> to resume!
        </div>
      `,
      controls: `
        <div class="slx-gg-two-col">
          <div class="slx-gg-card">
            <h4>🖱️ Mouse &amp; Touch Controls (Zero Keyboard Needed)</h4>
            <ul>
              <li><strong>Switch Active Ship:</strong> Click any of your 3 ship cards in the right-hand <strong>⚓ Fleet</strong> sidebar.</li>
              <li><strong>Toggle Move vs. Fire:</strong> Click the <strong>🟢 Move</strong> or <strong>🎯 Fire</strong> buttons in the top-left bar above the ocean.</li>
              <li><strong>Rotate Ship 90°:</strong> Click <strong>↻ Rotate</strong> before clicking your destination tile in Move Mode.</li>
              <li><strong>Pan &amp; Zoom Ocean:</strong> Drag the ocean canvas (or click anywhere on the bottom-right <strong>Radar Minimap</strong>) and use <strong>＋ / － / ⛶ Fit Sea</strong>.</li>
              <li><strong>Repair / Upgrade / Buy Ship:</strong> Use the action buttons in the right-hand <strong>⚓ Fleet</strong> deck whenever you have enough <code>CR</code>.</li>
            </ul>
          </div>
          <div class="slx-gg-card">
            <h4>⌨️ Optional Power-User Hotkeys</h4>
            <ul>
              <li><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> — Select Ship Slot 1, 2, or 3 &amp; center camera</li>
              <li>Hold <kbd>Shift</kbd> or <kbd>Space</kbd> (or Right-Click) — Instant Red Targeting Mode</li>
              <li><kbd>R</kbd> — Rotate destination hull orientation (Horizontal ↔ Vertical)</li>
              <li><kbd>C</kbd> — Center camera on active ship &bull; <kbd>F</kbd> — Fit entire ocean</li>
              <li><kbd>Esc</kbd> — Return to Green Move Mode</li>
            </ul>
          </div>
        </div>
        <div class="slx-gg-card" style="margin-top:12px;">
          <h4>🗺️ Visual Ocean Legend</h4>
          <div class="slx-gg-legend-row">
            <span><strong style="color:#34d399;">◯ Green Circle:</strong> Max sailing distance this move</span>
            <span><strong style="color:#fb7185;">◯ Red Ring:</strong> Max weapon firing range</span>
            <span><strong style="color:#fbbf24;">🔥 Cracked/Dark Square:</strong> Destroyed hull cell (repairable for <code>100 CR</code>)</span>
            <span><strong style="color:#67e8f9;">★ Gold Outline:</strong> Your own squadron vessels</span>
          </div>
        </div>
      `,
      reference: `
        <div class="slx-gg-card">
          <h4>🚢 Warship Hull Classes</h4>
          <table class="slx-gg-table">
            <thead>
              <tr><th>Class</th><th>Size</th><th>Cost</th><th>Base Speed</th><th>Max Weapon Mount</th><th>Sink Bounty</th></tr>
            </thead>
            <tbody>
              <tr><td>🚤 <strong>Patrol Gunboat</strong></td><td>2×1 (2 sq)</td><td>200 CR</td><td>12 sq</td><td>Small (S)</td><td>+120 CR</td></tr>
              <tr><td>⚓ <strong>Frigate</strong></td><td>3×1 (3 sq)</td><td>350 CR</td><td>8 sq</td><td>Medium (M)</td><td>+200 CR</td></tr>
              <tr><td>⛴️ <strong>Heavy Cruiser</strong></td><td>4×1 (4 sq)</td><td>550 CR</td><td>6 sq</td><td>Large (L)</td><td>+320 CR</td></tr>
              <tr><td>🛳️ <strong>Dreadnought</strong></td><td>5×2 (10 sq)</td><td>1,100 CR</td><td>4 sq</td><td>Extra-Large (XL)</td><td>+600 CR</td></tr>
            </tbody>
          </table>
        </div>
        <div class="slx-gg-card" style="margin-top:12px;">
          <h4>💥 Naval Weapons &amp; Impact Patterns</h4>
          <table class="slx-gg-table">
            <thead>
              <tr><th>Weapon</th><th>Mount</th><th>Cost</th><th>Range</th><th>Impact Pattern</th></tr>
            </thead>
            <tbody>
              <tr><td><strong>Deck Autocannon</strong></td><td>S+</td><td>Free (0 CR)</td><td>10 sq</td><td><code>1×1</code> Pinpoint (1 square)</td></tr>
              <tr><td><strong>Twin Torpedo Salvo</strong></td><td>S+</td><td>250 CR</td><td>9 sq</td><td><code>2×2</code> Area Blast (4 squares!)</td></tr>
              <tr><td><strong>155mm Howitzer</strong></td><td>M (Frigate+)</td><td>450 CR</td><td>14 sq</td><td><code>+</code> Cross Salvo (5 squares!)</td></tr>
              <tr><td><strong>280mm Broadside</strong></td><td>L (Cruiser+)</td><td>700 CR</td><td>18 sq</td><td><code>2×2</code> Long-Range Heavy (4 squares)</td></tr>
              <tr><td><strong>Siege Railgun</strong></td><td>XL (Dreadnought)</td><td>1,100 CR</td><td>30 sq</td><td><code>1×1</code> Cross-Map Sniper</td></tr>
            </tbody>
          </table>
        </div>
        <div class="slx-gg-tip-box" style="margin-top:12px;">
          <strong>💰 Credits (<code>CR</code>) vs. Peak High Score:</strong> Spending <code>CR</code> on repairs (<code>100 CR/sq</code>), engines (<code>+2/+4 speed</code>), or bigger ships <strong>never lowers your Score</strong>! If all 3 of your ships sink and you have under <code>200 CR</code>, your <strong>Peak High Score is permanently saved</strong> on the Leaderboard and you can click <strong>🔄 Start Anew</strong> for a fresh <code>1,000 CR</code> warchest.
        </div>
      `,
      onchain: `
        <div class="slx-gg-card">
          <h4>⛓️ 100% On-Chain Halt-Free Subroutine (<code>battleship.wasm</code>)</h4>
          <ul>
            <li><strong>Real secp256k1 Transactions Over Sub-GHz Radio:</strong> Every fleet deployment, maneuver, torpedo salvo, collision, and hull repair is a real signed transaction executed deterministically by all 5 Subnet 1 validators with <strong>$0 gas fees</strong>.</li>
            <li><strong>Event-Driven WebSocket Finality:</strong> When your move or shot confirms in a block (~4s), validators emit <code>ShipMoved</code>, <code>WeaponFired</code>, and <code>ShipSunk</code> logs over <code>eth_subscribe</code> — updating every player&rsquo;s ocean canvas live without centralized game servers.</li>
            <li><strong>Integrated VHF Comms:</strong> The <strong>📡 Comms</strong> tab connects directly to on-chain <code>Messaging</code> and <code>SocialFeed</code> subroutines so captains can coordinate salvos on Bridge Channel 16.</li>
          </ul>
        </div>
      `,
    },
  },

  'cipher-noir': {
    icon: '🕵️',
    title: 'Cipher Noir: Syndicate Sabotage — Investigator’s Manual',
    accent: '#22d3ee',
    tagline:
      'Arbiter-free zero-knowledge espionage deduction (inspired by Clue / Cluedo) — deduce WHO sabotaged the Geneva Quantum Clearinghouse, WITH WHAT exploit, and IN WHICH sector using Bulletproofs R1CS, 5-Validator Threshold ElGamal, and 1-of-3 ZK Whispers!',
    welcomePrimaryLabel: '🕵️ Got It — Enter the Clearinghouse',
    quickSteps: [
      {
        num: '1',
        title: '18 Dossiers: 3 Locked in the Vault, 15 Dealt as Alibis',
        body: 'There are 5 Operatives, 5 Exploits, and 8 Facility Sectors (18 cards total). Exactly 1 Operative + 1 Exploit + 1 Sector are sealed inside the Case Vault; the remaining 15 cards are dealt privately to the 5 seats (3 Alibi cards each).',
      },
      {
        num: '2',
        title: 'Move to a Sector & Transmit a 3-Card Forensic Probe',
        body: 'On your turn, click a glowing Reachable Sector on the blueprint, pick any Suspect Operative + Exploit, and click 📡 Transmit Probe. Checking clockwise, the first player holding ANY of those 3 cards must privately whisper 1 matching Alibi to you!',
      },
      {
        num: '3',
        title: 'Cross Off Alibis Until 3 🎯 Targets Remain — Then Indict!',
        body: 'Your Deduction Matrix automatically marks every card you hold or receive via whisper with ✓ (clearing it!). Once you isolate the 1 Operative, 1 Exploit, and 1 Sector NOBODY holds, click ⚖️ File Indictment to unseal the Vault and win!',
      },
    ],
    tabs: {
      quickstart: `
        <div class="slx-gg-hero">
          <div class="slx-gg-hero-title">🔐 Never Played a Deduction Mystery Before? Here’s the Core Logic</div>
          <p>
            Imagine <strong>18 illustrated evidence cards</strong> split into 3 categories: <strong>5 Suspect Operatives</strong>, <strong>5 Sabotage Exploits</strong>, and <strong>8 Clearinghouse Sectors</strong>.
            At the start of every case, two independent players co-shuffle the deck in Zero Knowledge under the <strong>5-Validator Threshold Public Key</strong>, locking <strong>1 Culprit + 1 Exploit + 1 Sector</strong> inside the <strong>Threshold Case Vault</strong> (known to <em>nobody</em>!) and dealing the other <strong>15 cards</strong> via DDH-blinded shares.
          </p>
          <p style="margin-top:6px;">
            <strong>Golden Rule:</strong> Every card exists only <em>once</em>! So if you see a card in your own 3-card hand — or another player privately whispers it to you — that card is <strong>100% innocent (an Alibi)</strong> and <em>cannot</em> be inside the Case Vault!
          </p>
        </div>
        <div class="slx-gg-steps-grid">
          <div class="slx-gg-step-card">
            <span class="slx-gg-step-num">STEP 1</span>
            <h4>Co-Shuffle &amp; Unlock DDH Hand</h4>
            <p>Click <strong>⚡ Join, Co-Shuffle &amp; Deal</strong> (or <strong>↻ New Case</strong>). Your browser proves a 16-gate <code>Bulletproofs R1CS</code> shuffle and unlocks your 3 DDH-blinded Alibi cards.</p>
          </div>
          <div class="slx-gg-step-card">
            <span class="slx-gg-step-num">STEP 2</span>
            <h4>Probe &amp; Whisper Alibis</h4>
            <p>On your turn, pick a reachable Sector + Suspect + Exploit and click <strong>📡 Transmit Probe</strong>. If someone else&rsquo;s Probe matches a card in <em>your</em> hand, a bright green <strong>Whisper Alert Bar</strong> prompts you to privately show 1 card.</p>
          </div>
          <div class="slx-gg-step-card">
            <span class="slx-gg-step-num">STEP 3</span>
            <h4>File Your Winning Indictment</h4>
            <p>When your right-hand <strong>Deduction Matrix</strong> isolates the final un-cleared <code>🎯</code> Operative, Exploit, and Sector, click <strong>⚖️ File Indictment</strong> anytime to win! <em>(Careful: a wrong indictment revokes your clearance!)</em></p>
          </div>
        </div>
      `,
      controls: `
        <div class="slx-gg-two-col">
          <div class="slx-gg-card">
            <h4>🏛️ Moving Across the 8-Sector Blueprint</h4>
            <ul>
              <li><strong>Reachable Sectors Glow Cyan:</strong> On your turn, you can move up to 2 grid steps across the 2×4 Geneva Clearinghouse blueprint — simply click any glowing room card to select it for your Probe!</li>
              <li><strong>⇄ Quantum Transit Tubes (Secret Passages):</strong>
                <ul>
                  <li><strong>Cryo-Server Core ↔ Helipad Airlock</strong> (opposite corners)</li>
                  <li><strong>Diplomatic Atrium ↔ Faraday Vault</strong></li>
                </ul>
              </li>
              <li><strong>Pulled Into a Sector?</strong> If another Operative named your character in their Probe, you were pulled into that room — allowing you to re-probe that same room without moving first!</li>
            </ul>
          </div>
          <div class="slx-gg-card">
            <h4>📓 Reading the Zero-Knowledge Deduction Matrix</h4>
            <ul>
              <li><strong style="color:#34d399;"><code>✓</code> Green Check (Cleared Alibi):</strong> Confirmed held by that seat (either in your hand or privately whispered to you). This row is crossed out — it is <em>not</em> in the Vault!</li>
              <li><strong style="color:#f87171;"><code>✕</code> Red Cross (Passed):</strong> That seat publicly passed during a Probe containing this card, proving they do <em>not</em> hold it!</li>
              <li><strong style="color:#fbbf24;"><code>🎯</code> Gold Target (Prime Vault Suspect):</strong> Automatically highlights when 4 of 5 Operatives (or Exploits, or 7 of 8 Sectors) are cleared — leaving this card as the <strong>exact Vault culprit</strong>!</li>
              <li><strong>Click Any Cell (<code>?</code>):</strong> Click any <code>·</code> cell in the table to jot down your own <code>?</code> hunch notes.</li>
            </ul>
          </div>
        </div>
      `,
      reference: `
        <div class="slx-gg-two-col">
          <div class="slx-gg-card">
            <h4>🗂️ Complete 18-Dossier Manifest</h4>
            <ul>
              <li><strong>5 Operatives:</strong> Cipher Vex, Director Kestrel, Dr. Lyra Vance, Broker Rook, Envoy Sable</li>
              <li><strong>5 Sabotage Exploits:</strong> Zero-Day Firmware, Cryo-Key Siphon, EMP Micro-Pulse, Forged Quorum Token, Laser Side-Channel</li>
              <li><strong>8 Facility Sectors:</strong> Cryo-Server Core, Validator Rotunda, Fiber Splice Lab, Diplomatic Atrium, Faraday Vault, Dark-Pool Desk, Substation Alpha, Helipad Airlock</li>
            </ul>
          </div>
          <div class="slx-gg-card">
            <h4>🧠 Pro Detective Strategy Tips</h4>
            <ul>
              <li><strong>Bluff-Probe With Your Own Alibi Cards!</strong> You are allowed to include 1 or 2 cards from <em>your own hand</em> in a Probe! Why? If you already hold <em>Zero-Day Firmware</em> and probe <code>[Broker Rook + Zero-Day Firmware + Faraday Vault]</code>, opponents can&rsquo;t show you the Exploit — forcing them to reveal whether they hold Rook or Faraday Vault!</li>
              <li><strong>Watch Public Passes (<code>✕</code>):</strong> Even when it isn&rsquo;t your turn, pay attention to who passes! If 4 players in a row pass on a Probe, either the Prober holds those cards or they&rsquo;re sitting inside the Case Vault!</li>
            </ul>
          </div>
        </div>
      `,
      onchain: `
        <div class="slx-gg-card">
          <h4>🔐 Zero-Trusted-Setup Bulletproofs + 5-Validator Threshold Cryptography</h4>
          <p>Cipher Noir achieves <strong>100% Arbiter-Free, Mathematically Cheat-Proof</strong> hidden-information gameplay on a public blockchain with zero trusted setup:</p>
          <ul>
            <li><strong>1. 2-Party Verifiable Co-Shuffle &amp; Threshold Vault:</strong> Two independent players permute &amp; ElGamal-rerandomize the 18 Dossiers under the 5-Validator Threshold Public Key, verified on-chain via 16-gate <strong>Bulletproofs R1CS</strong> grand-product proofs. Nobody in the world knows the 3 Vault cards!</li>
            <li><strong>2. DDH-Blinded Hand Delivery:</strong> Each Operative&rsquo;s 3 cards are blinded by private <code>Edwards25519</code> scalars <code>U<sub>s,k</sub> = u<sub>s,k</sub> &middot; B</code> before validator decryption, and bound on-chain into Pedersen commitments <code>V<sub>s,k</sub> = c<sub>k</sub> &middot; B + w<sub>s,k</sub> &middot; H<sub>bp</sub></code>.</li>
            <li><strong>3. Cheat-Proof R1CS Passes &amp; 1-of-3 ZK Whispers:</strong> Passing requires a 672B <strong>Bulletproofs R1CS</strong> proof that <code>&prod;(c<sub>k</sub> - p<sub>m</sub>) &middot; inv = 1</code> (bluff-passing reverts on-chain!). Whispering requires a 352B <strong>1-of-3 Disjunctive Schnorr/ElGamal Proof</strong> hiding <em>which</em> card matched from bystanders, and indictments use 2-party non-zero co-blinding so wrong guesses leak <strong>0 bits</strong>!</li>
          </ul>
        </div>
      `,
    },
  },

  hegemony: {
    icon: '⬢',
    title: 'Fractured Hegemony — Sovereign Command Manual',
    accent: '#f59e0b',
    tagline:
      'Simultaneous-turn grand strategy across 36 global sectors (inspired by Risk + Diplomacy) — where every Sovereign reinforces, strikes, and negotiates treaties at the exact same time with zero turn-order unfairness!',
    welcomePrimaryLabel: '⚔️ Got It — Enter Command Table',
    quickSteps: [
      {
        num: '1',
        title: 'Launch a Sovereign Uprising (Instant 3-Sector Enclave)',
        body: 'Click any territory on the world map to pick a preferred landing zone, then click ⚔️ Launch Sovereign Uprising. You immediately claim a fortified Citadel (8 Legions + 20% defense), 2 flanking territories (5 Legions each), and 8 Supply!',
      },
      {
        num: '2',
        title: 'Stage Reinforcements (+Supply) & Adjacent Strikes',
        body: 'Click one of YOUR colored territories to deploy +Supply legions, then click an adjacent gold-ringed enemy territory to stage a Vector Strike — or click ⚡ Auto-Plan to automatically stage smart border defenses and high-odds attacks!',
      },
      {
        num: '3',
        title: 'Commit Directives Before the 2-Block (~8.5s) Clash!',
        body: 'Staged moves are local until you click 🚀 Commit Directives! Every 2 blocks, all committed Sovereigns resolve simultaneously — capture 24 of the 36 global sectors to be crowned Epoch Hegemon!',
      },
    ],
    tabs: {
      quickstart: `
        <div class="slx-gg-hero">
          <div class="slx-gg-hero-title">👑 Victory Condition &amp; Simultaneous Rhythm</div>
          <p>
            Conquer <strong>24 of the 36 global sectors</strong> to win the current <strong>Epoch</strong>, etch your victory into the permanent on-chain Hall of Sovereigns, and fracture the map into a new Epoch!
            Unlike classic board games where waiting 20 minutes for your turn is boring, <strong>every Cycle lasts ~2 blocks (~8.5 seconds)</strong> and all Sovereigns&rsquo; committed orders resolve <strong>simultaneously</strong>.
          </p>
        </div>
        <div class="slx-gg-steps-grid">
          <div class="slx-gg-step-card">
            <span class="slx-gg-step-num">STEP 1</span>
            <h4>Claim Your Citadel</h4>
            <p>Own <code>0</code> sectors? Click <strong>⚔️ Launch Sovereign Uprising</strong> anytime to drop in with 3 territories + 8 Supply. Even if wiped out later, you can re-launch immediately!</p>
          </div>
          <div class="slx-gg-step-card">
            <span class="slx-gg-step-num">STEP 2</span>
            <h4>Stage (Or ⚡ Auto-Plan)</h4>
            <p>Click your territory to add <code>+Supply</code>, then click a connected enemy node to stage a Strike (leaving at least <code>1</code> garrison legion behind). Unsure? Click <strong>⚡ Auto-Plan</strong>!</p>
          </div>
          <div class="slx-gg-step-card">
            <span class="slx-gg-step-num">STEP 3</span>
            <h4>🚀 Commit Directives</h4>
            <p>Click <strong>🚀 Commit Directives</strong> to sign your orders on-chain (you&rsquo;ll see a green <code>✓ COMMITTED</code> badge). Once 2 blocks pass, click <strong>⏱ Resolve Cycle</strong> (or let the AI keeper trigger it)!</p>
          </div>
        </div>
      `,
      controls: `
        <div class="slx-gg-two-col">
          <div class="slx-gg-card">
            <h4>🖱️ Map &amp; Console Controls</h4>
            <ul>
              <li><strong>Select Your Territory:</strong> Click any circle matching your Sovereign color swatch. Use the bottom console&rsquo;s <code>+1</code> / <code>+3</code> / <code>+All</code> buttons to stage reinforcements from your Supply pool.</li>
              <li><strong>Stage a Vector Strike:</strong> While one of your territories (with <code>2+</code> legions) is selected, neighboring targets glow with a <strong>dashed gold ring</strong>. Click a neighbor to stage an attack arrow!</li>
              <li><strong>⚡ Auto-Plan Button:</strong> One click analyzes your borders, reinforces threatened Citadels/Relays, and stages high-probability strikes automatically — great for learning!</li>
              <li><strong>Clear Staged:</strong> Click <code>Clear</code> in the Staged Directives box to redo your plan before committing.</li>
            </ul>
          </div>
          <div class="slx-gg-card">
            <h4>🗺️ World Map Symbol Legend</h4>
            <ul>
              <li><strong>Number Inside Circle:</strong> Current garrisoned Legions in that territory.</li>
              <li><strong>Double Ring (Citadel):</strong> Sovereign capital enclave — grants a <strong>+20% Siege Defense bonus</strong>!</li>
              <li><strong style="color:#67e8f9;">⚡ Lightning Ring (Aether Relay):</strong> Strategic orbital uplink (<em>Baikal Relay, Nile Nexus, Geneva Prime</em>) — grants <strong>+2 extra Supply</strong> every cycle!</li>
              <li><strong>Curved Dashed Arcs (Warp Lanes):</strong> Trans-oceanic sea/orbital corridors connecting <em>Yukon ↔ Bering Watch</em>, <em>Cascadia ↔ Kuroshio Arc</em>, and <em>Tierra Austral ↔ Zealandia Spire</em>.</li>
            </ul>
          </div>
        </div>
      `,
      reference: `
        <div class="slx-gg-two-col">
          <div class="slx-gg-card">
            <h4>🌍 6 Tectonic Confederation Supply Bonuses</h4>
            <p style="font-size:12px;margin-bottom:6px;">Hold <em>every</em> territory in a color-coded region at cycle end to earn bonus Supply:</p>
            <table class="slx-gg-table">
              <thead><tr><th>Confederation</th><th>Sectors</th><th>Cycle Bonus</th></tr></thead>
              <tbody>
                <tr><td><strong style="color:#38bdf8;">Boreal Atlantic</strong> (N. America)</td><td>6</td><td><code>+4 Supply</code></td></tr>
                <tr><td><strong style="color:#f59e0b;">Andean Austral</strong> (S. America)</td><td>5</td><td><code>+3 Supply</code></td></tr>
                <tr><td><strong style="color:#f43f5e;">Boreal Steppe</strong> (N. Eurasia)</td><td>7</td><td><code>+6 Supply</code></td></tr>
                <tr><td><strong style="color:#10b981;">Afro-Med League</strong> (Africa)</td><td>6</td><td><code>+4 Supply</code></td></tr>
                <tr><td><strong style="color:#a855f7;">Pelagic Rim</strong> (SE Asia/Oceania)</td><td>5</td><td><code>+3 Supply</code></td></tr>
                <tr><td><strong style="color:#eab308;">Continental Silk Core</strong> (Europe/Asia)</td><td>7</td><td><code>+5 Supply</code></td></tr>
              </tbody>
            </table>
          </div>
          <div class="slx-gg-card">
            <h4>⚔️ Simultaneous Combat &amp; 🤝 Treaty Rules</h4>
            <ul>
              <li><strong>Reinforcements Land First:</strong> Every Sovereign&rsquo;s staged <code>+Supply</code> deployments reinforce garrisons <em>before</em> outgoing strikes launch.</li>
              <li><strong>Head-On Corridor Collisions:</strong> If you strike A → B while B simultaneously strikes B → A, both armies clash mid-corridor before reaching the cities!</li>
              <li><strong>Multi-Faction Sieges:</strong> If two Sovereigns strike the same territory at once, the largest surviving force claims it; ties leave the territory contested/weakened.</li>
              <li><strong>🤝 6-Cycle Compacts &amp; Oathbreakers:</strong> Click <code>🤝</code> next to any rival in the Hall of Sovereigns to propose a truce. Attacking a ratified ally brands you an <strong>Oathbreaker</strong> on-chain and grants the victim <strong>+6 Emergency Supply</strong>!</li>
            </ul>
          </div>
        </div>
      `,
      onchain: `
        <div class="slx-gg-card">
          <h4>⛓️ Deterministic Simultaneous Execution (<code>hegemony.wasm</code>)</h4>
          <ul>
            <li><strong>Zero Turn-Order Bias:</strong> Every <code>stageDirectives</code> transaction writes your cycle orders into contract storage on Subnet 1. When <code>resolveCycle</code> executes after 2 blocks, the Rust WASM subroutine resolves all reinforcements, head-on collisions, sieges, and supply income in a single atomic state transition.</li>
            <li><strong>Drop-In / Drop-Out Persistence:</strong> Autonomous AI Sovereigns and human Commanders coexist 24/7 on the same live global map over Sub-GHz RF consensus with <strong>$0 gas</strong>.</li>
          </ul>
        </div>
      `,
    },
  },
};

function injectGuideStyles() {
  if (document.getElementById('slx-game-guide-styles')) return;
  const style = document.createElement('style');
  style.id = 'slx-game-guide-styles';
  style.textContent = `
    /* Prominent Header "How to Play" Pill */
    .slx-gg-hdr-btn {
      display: inline-flex !important;
      align-items: center;
      gap: 6px;
      padding: 6px 12px !important;
      border-radius: 9px !important;
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.22) 0%, rgba(168, 85, 247, 0.22) 100%) !important;
      border: 1.5px solid rgba(103, 232, 249, 0.6) !important;
      color: #f8fafc !important;
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace !important;
      font-size: 11.5px !important;
      font-weight: 800 !important;
      cursor: pointer;
      white-space: nowrap;
      box-shadow: 0 2px 10px rgba(34, 211, 238, 0.18);
      transition: all 0.15s ease;
    }
    .slx-gg-hdr-btn:hover {
      border-color: #fde047 !important;
      color: #fef08a !important;
      transform: translateY(-1px);
    }

    /* First-Visit 3-Step Quick-Start Welcome Card */
    .slx-gg-welcome {
      margin: 0 0 8px 0;
      padding: 12px 15px;
      border-radius: 13px;
      background: linear-gradient(135deg, rgba(15, 23, 42, 0.97) 0%, rgba(8, 47, 73, 0.92) 100%);
      border: 1.5px solid rgba(56, 189, 248, 0.55);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
      color: #e2e8f0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .slx-gg-welcome.slx-hidden {
      display: none !important;
    }
    .slx-gg-welcome-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }
    .slx-gg-welcome-kicker {
      display: inline-block;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #67e8f9;
      background: rgba(34, 211, 238, 0.14);
      border: 1px solid rgba(34, 211, 238, 0.35);
      padding: 2px 7px;
      border-radius: 999px;
      margin-bottom: 4px;
    }
    .slx-gg-welcome-title {
      margin: 0;
      font-size: 14.5px;
      font-weight: 800;
      color: #f8fafc;
    }
    .slx-gg-welcome-sub {
      margin: 3px 0 0 0;
      font-size: 12px;
      line-height: 1.45;
      color: #cbd5e1;
      max-width: 780px;
    }
    .slx-gg-welcome-steps {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 9px;
      margin-bottom: 10px;
    }
    @media (max-width: 900px) {
      .slx-gg-welcome-steps {
        grid-template-columns: 1fr;
      }
    }
    .slx-gg-welcome-step {
      background: rgba(2, 6, 23, 0.62);
      border: 1px solid rgba(148, 163, 184, 0.24);
      border-radius: 10px;
      padding: 9px 11px;
      font-size: 11.5px;
      line-height: 1.42;
      color: #cbd5e1;
    }
    .slx-gg-welcome-step-hdr {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 800;
      color: #f8fafc;
      margin-bottom: 3px;
      font-size: 12px;
    }
    .slx-gg-welcome-num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 19px;
      height: 19px;
      border-radius: 999px;
      background: #38bdf8;
      color: #020617;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11px;
      font-weight: 900;
      flex-shrink: 0;
    }
    .slx-gg-welcome-ftr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }
    .slx-gg-welcome-note {
      font-size: 11px;
      color: #94a3b8;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .slx-gg-btn-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .slx-gg-btn {
      appearance: none;
      border-radius: 8px;
      padding: 7px 12px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11.5px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .slx-gg-btn-ghost {
      background: rgba(30, 41, 59, 0.85);
      border: 1px solid rgba(148, 163, 184, 0.4);
      color: #e2e8f0;
    }
    .slx-gg-btn-ghost:hover {
      background: rgba(51, 65, 85, 0.95);
    }
    .slx-gg-btn-cta {
      background: linear-gradient(135deg, #22d3ee 0%, #10b981 100%);
      border: 1px solid rgba(110, 231, 183, 0.8);
      color: #020617;
      font-weight: 800;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.28);
    }
    .slx-gg-btn-cta:hover {
      filter: brightness(1.07);
      transform: translateY(-1px);
    }

    /* Live Contextual "NEXT STEP" Coach Bar */
    .slx-gg-coach {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      padding: 7px 11px;
      margin-bottom: 6px;
      border-radius: 10px;
      background: rgba(15, 23, 42, 0.88);
      border: 1px solid rgba(56, 189, 248, 0.35);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 12px;
      line-height: 1.4;
      color: #e2e8f0;
    }
    .slx-gg-coach[data-tone="action"] {
      background: linear-gradient(90deg, rgba(6, 78, 59, 0.55) 0%, rgba(15, 23, 42, 0.9) 100%);
      border-color: rgba(52, 211, 153, 0.6);
    }
    .slx-gg-coach[data-tone="urgent"] {
      background: linear-gradient(90deg, rgba(120, 53, 15, 0.62) 0%, rgba(127, 29, 29, 0.45) 100%);
      border-color: rgba(251, 191, 36, 0.75);
    }
    .slx-gg-coach[data-tone="target"] {
      background: linear-gradient(90deg, rgba(136, 19, 55, 0.52) 0%, rgba(15, 23, 42, 0.9) 100%);
      border-color: rgba(251, 113, 133, 0.65);
    }
    .slx-gg-coach-left {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      min-width: 0;
      flex: 1 1 420px;
    }
    .slx-gg-coach-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 999px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      background: rgba(56, 189, 248, 0.18);
      border: 1px solid rgba(56, 189, 248, 0.45);
      color: #7dd3fc;
      flex-shrink: 0;
    }
    .slx-gg-coach[data-tone="action"] .slx-gg-coach-pill {
      background: rgba(16, 185, 129, 0.22);
      border-color: rgba(52, 211, 153, 0.6);
      color: #6ee7b7;
    }
    .slx-gg-coach[data-tone="urgent"] .slx-gg-coach-pill {
      background: rgba(245, 158, 11, 0.25);
      border-color: rgba(251, 191, 36, 0.7);
      color: #fde68a;
    }
    .slx-gg-coach[data-tone="target"] .slx-gg-coach-pill {
      background: rgba(244, 63, 94, 0.25);
      border-color: rgba(251, 113, 133, 0.65);
      color: #fda4af;
    }
    .slx-gg-coach-text strong {
      color: #f8fafc;
      font-weight: 700;
    }
    .slx-gg-coach-right {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .slx-gg-coach-action {
      appearance: none;
      padding: 4px 10px;
      border-radius: 7px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11px;
      font-weight: 800;
      background: rgba(251, 191, 36, 0.2);
      border: 1px solid rgba(251, 191, 36, 0.65);
      color: #fde047;
      cursor: pointer;
      white-space: nowrap;
    }
    .slx-gg-coach-action:hover {
      background: rgba(251, 191, 36, 0.32);
    }
    .slx-gg-coach-help {
      appearance: none;
      padding: 4px 8px;
      border-radius: 7px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px;
      font-weight: 700;
      background: rgba(30, 41, 59, 0.75);
      border: 1px solid rgba(148, 163, 184, 0.35);
      color: #cbd5e1;
      cursor: pointer;
      white-space: nowrap;
    }
    .slx-gg-coach-help:hover {
      color: #fff;
      border-color: rgba(148, 163, 184, 0.65);
    }

    /* 4-Tab Full Field Manual Modal */
    .slx-gg-backdrop {
      position: fixed;
      inset: 0;
      z-index: 9995;
      background: rgba(2, 6, 23, 0.84);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .slx-gg-backdrop.slx-open {
      display: flex;
    }
    .slx-gg-modal {
      width: min(920px, 96vw);
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      background: #0b1222;
      border: 1.5px solid rgba(56, 189, 248, 0.42);
      border-radius: 16px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.85);
      color: #e2e8f0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      overflow: hidden;
    }
    .slx-gg-modal-hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 20px;
      background: rgba(15, 23, 42, 0.95);
      border-bottom: 1px solid rgba(148, 163, 184, 0.2);
    }
    .slx-gg-modal-hdr h2 {
      margin: 0;
      font-size: 16px;
      font-weight: 800;
      color: #f8fafc;
    }
    .slx-gg-modal-sub {
      margin: 3px 0 0 0;
      font-size: 12px;
      color: #94a3b8;
    }
    .slx-gg-tabs {
      display: flex;
      gap: 6px;
      padding: 10px 20px;
      background: rgba(8, 13, 26, 0.95);
      border-bottom: 1px solid rgba(148, 163, 184, 0.16);
      overflow-x: auto;
    }
    .slx-gg-tab {
      appearance: none;
      padding: 7px 12px;
      border-radius: 8px;
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid rgba(148, 163, 184, 0.25);
      color: #94a3b8;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11.5px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s ease;
    }
    .slx-gg-tab:hover {
      color: #e2e8f0;
    }
    .slx-gg-tab.slx-active {
      background: rgba(56, 189, 248, 0.18);
      border-color: rgba(56, 189, 248, 0.65);
      color: #67e8f9;
    }
    .slx-gg-body {
      padding: 18px 20px;
      overflow-y: auto;
      font-size: 13px;
      line-height: 1.6;
      color: #cbd5e1;
    }
    .slx-gg-hero {
      padding: 13px 15px;
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(34, 211, 238, 0.12) 0%, rgba(16, 185, 129, 0.1) 100%);
      border: 1px solid rgba(56, 189, 248, 0.35);
      margin-bottom: 14px;
    }
    .slx-gg-hero p {
      margin: 0;
    }
    .slx-gg-hero-title {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 13px;
      font-weight: 800;
      color: #67e8f9;
      margin-bottom: 5px;
    }
    .slx-gg-steps-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }
    @media (max-width: 780px) {
      .slx-gg-steps-grid {
        grid-template-columns: 1fr;
      }
    }
    .slx-gg-step-card {
      padding: 12px 14px;
      border-radius: 11px;
      background: rgba(15, 23, 42, 0.72);
      border: 1px solid rgba(148, 163, 184, 0.24);
    }
    .slx-gg-step-num {
      display: inline-block;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10px;
      font-weight: 800;
      color: #fcd34d;
      background: rgba(245, 158, 11, 0.16);
      border: 1px solid rgba(245, 158, 11, 0.4);
      padding: 1px 6px;
      border-radius: 999px;
      margin-bottom: 5px;
    }
    .slx-gg-step-card h4 {
      margin: 0 0 5px 0;
      font-size: 13.5px;
      color: #f8fafc;
    }
    .slx-gg-step-card p {
      margin: 0;
      font-size: 12.2px;
      color: #cbd5e1;
    }
    .slx-gg-two-col {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    @media (max-width: 780px) {
      .slx-gg-two-col {
        grid-template-columns: 1fr;
      }
    }
    .slx-gg-card {
      padding: 13px 15px;
      border-radius: 11px;
      background: rgba(15, 23, 42, 0.68);
      border: 1px solid rgba(148, 163, 184, 0.22);
    }
    .slx-gg-card h4 {
      margin: 0 0 8px 0;
      font-size: 13px;
      font-weight: 800;
      color: #f8fafc;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .slx-gg-card ul {
      margin: 0;
      padding-left: 18px;
    }
    .slx-gg-card li {
      margin-bottom: 6px;
      font-size: 12.4px;
    }
    .slx-gg-legend-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 18px;
      font-size: 12px;
    }
    .slx-gg-tip-box {
      padding: 11px 14px;
      border-radius: 10px;
      background: rgba(245, 158, 11, 0.12);
      border: 1px solid rgba(245, 158, 11, 0.4);
      color: #fef3c7;
      font-size: 12.3px;
    }
    .slx-gg-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .slx-gg-table th,
    .slx-gg-table td {
      text-align: left;
      padding: 6px 8px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.16);
    }
    .slx-gg-table th {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.8px;
      text-transform: uppercase;
      color: #94a3b8;
    }
    .slx-gg-body code,
    .slx-gg-welcome code,
    .slx-gg-coach code {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11px;
      padding: 1px 5px;
      border-radius: 4px;
      background: rgba(2, 6, 23, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.25);
      color: #67e8f9;
    }
    .slx-gg-body kbd {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px;
      padding: 1px 6px;
      border-radius: 4px;
      background: #1e293b;
      border: 1px solid #475569;
      color: #f8fafc;
    }
    .slx-gg-modal-ftr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      padding: 12px 20px;
      background: rgba(15, 23, 42, 0.95);
      border-top: 1px solid rgba(148, 163, 184, 0.2);
      font-size: 11.5px;
      color: #94a3b8;
    }
    @media (max-width: 768px) {
      .slx-gg-welcome {
        padding: 10px 12px !important;
        gap: 8px !important;
      }
      .slx-gg-welcome-steps,
      .slx-gg-welcome-note,
      .slx-gg-welcome-sub {
        display: none !important;
      }
      .slx-gg-welcome-title {
        font-size: 13.5px !important;
        margin: 2px 0 0 !important;
      }
      .slx-gg-coach {
        padding: 7px 10px !important;
        font-size: 11.5px !important;
      }
    }
    @media (max-width: 640px) {
      .slx-gg-hdr-btn {
        padding: 4px 8px !important;
        font-size: 11px !important;
      }
      .slx-gg-backdrop {
        padding: 0 !important;
        align-items: flex-end !important;
      }
      .slx-gg-modal {
        max-width: 100% !important;
        width: 100% !important;
        max-height: 92dvh !important;
        border-radius: 14px 14px 0 0 !important;
        border-left: none !important;
        border-right: none !important;
        border-bottom: none !important;
      }
      .slx-gg-modal-hdr,
      .slx-gg-tabs,
      .slx-gg-body {
        padding-left: 13px !important;
        padding-right: 13px !important;
      }
      .slx-gg-modal-ftr {
        padding: 10px 13px calc(10px + env(safe-area-inset-bottom)) !important;
      }
      .slx-gg-table {
        display: block;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Mount the 3-part onboarding suite for a game:
 *  - Styles & wires `headerBtnEl` as `📖 How to Play`
 *  - Renders first-visit 3-Step Quick-Start card into `welcomeMountEl`
 *  - Renders live Contextual Coach bar into `coachMountEl`
 */
export function mountSlxGameGuide({
  gameId,
  headerBtnEl,
  welcomeMountEl,
  coachMountEl,
  onWelcomePrimaryAction,
  onLayoutChange,
}) {
  if (typeof document === 'undefined') {
    return { openModal: () => {}, updateCoach: () => {}, isWelcomeVisible: () => false };
  }
  const spec = GAME_MANUALS[gameId];
  if (!spec) {
    throw new Error(`Unknown gameId for mountSlxGameGuide: ${gameId}`);
  }
  injectGuideStyles();

  // 1. Style & wire the always-visible "📖 Instructions" button in the Unified Header
  if (headerBtnEl) {
    headerBtnEl.classList.add('slx-gg-hdr-btn');
    headerBtnEl.innerHTML = `📖 Instructions`;
    headerBtnEl.title = `Open ${spec.title} (Quick-Start, Controls, Reference & Strategy)`;
  }

  // 2. Build the 4-Tab Field Manual Modal
  const backdrop = document.createElement('div');
  backdrop.className = 'slx-gg-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.innerHTML = `
    <div class="slx-gg-modal" onclick="event.stopPropagation()">
      <div class="slx-gg-modal-hdr">
        <div>
          <h2>${spec.icon} ${spec.title}</h2>
          <p class="slx-gg-modal-sub">${spec.tagline}</p>
        </div>
        <button type="button" class="slx-gg-btn slx-gg-btn-ghost" data-gg-close="1">✕</button>
      </div>
      <div class="slx-gg-tabs" role="tablist">
        <button type="button" class="slx-gg-tab slx-active" data-gg-tab="quickstart">🚀 Quick-Start (3 Steps)</button>
        <button type="button" class="slx-gg-tab" data-gg-tab="controls">🎮 Controls &amp; Legend</button>
        <button type="button" class="slx-gg-tab" data-gg-tab="reference">📊 Reference &amp; Strategy</button>
        <button type="button" class="slx-gg-tab" data-gg-tab="onchain">⛓️ On-Chain Proof</button>
      </div>
      <div class="slx-gg-body" data-gg-body="1"></div>
      <div class="slx-gg-modal-ftr">
        <span>Tip: Reopen <strong>📖 Instructions</strong> or <strong>🏛️ Description</strong> anytime from the top header bar.</span>
        <div class="slx-gg-btn-row">
          <button type="button" class="slx-gg-btn slx-gg-btn-ghost" data-gg-open-desc="1">🏛️ HFS Description</button>
          <button type="button" class="slx-gg-btn slx-gg-btn-ghost" data-gg-reshow="1">↻ Welcome Card</button>
          <button type="button" class="slx-gg-btn slx-gg-btn-cta" data-gg-close="1">✓ Ready to Play</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const bodyEl = backdrop.querySelector('[data-gg-body]');
  const tabBtns = Array.from(backdrop.querySelectorAll('[data-gg-tab]'));

  function selectTab(tabKey) {
    tabBtns.forEach((btn) => {
      btn.classList.toggle('slx-active', btn.getAttribute('data-gg-tab') === tabKey);
    });
    if (bodyEl) {
      bodyEl.innerHTML = spec.tabs[tabKey] || spec.tabs.quickstart;
      bodyEl.scrollTop = 0;
    }
  }
  selectTab('quickstart');

  function openModal(tabKey = 'quickstart') {
    selectTab(tabKey);
    backdrop.classList.add('slx-open');
  }

  function closeModal() {
    backdrop.classList.remove('slx-open');
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => selectTab(btn.getAttribute('data-gg-tab') || 'quickstart'));
  });
  backdrop.querySelectorAll('[data-gg-close]').forEach((btn) => {
    btn.addEventListener('click', closeModal);
  });
  backdrop.querySelector('[data-gg-open-desc]')?.addEventListener('click', () => {
    closeModal();
    if (typeof window !== 'undefined' && typeof window.openSlxUseCaseDescription === 'function') {
      window.openSlxUseCaseDescription(gameId);
    }
  });
  if (typeof window !== 'undefined') {
    window.__slxGameGuideOpeners = window.__slxGameGuideOpeners || {};
    window.__slxGameGuideOpeners[gameId] = openModal;
    window.__slxOpenGameGuide = (targetId, tabKey = 'quickstart') => {
      const fn = window.__slxGameGuideOpeners?.[targetId];
      if (typeof fn === 'function') {
        fn(tabKey);
        return true;
      }
      return false;
    };
  }
  backdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && backdrop.classList.contains('slx-open')) {
      closeModal();
    }
  });

  if (headerBtnEl) {
    headerBtnEl.addEventListener('click', (ev) => {
      ev.preventDefault();
      openModal('quickstart');
    });
  }

  // 3. First-Visit 3-Step Quick-Start Welcome Card
  let welcomeCard = null;
  let welcomeVisible = !hasSeenGameWelcome(gameId);

  if (welcomeMountEl) {
    welcomeCard = document.createElement('section');
    welcomeCard.className = `slx-gg-welcome ${welcomeVisible ? '' : 'slx-hidden'}`;
    welcomeCard.innerHTML = `
      <div class="slx-gg-welcome-top">
        <div>
          <span class="slx-gg-welcome-kicker">👋 New Here? 30-Second Quick-Start Guide</span>
          <h3 class="slx-gg-welcome-title">${spec.icon} How ${spec.title.split('—')[0].trim()} Works</h3>
          <p class="slx-gg-welcome-sub">${spec.tagline}</p>
        </div>
        <button type="button" class="slx-gg-btn slx-gg-btn-ghost" data-gg-dismiss="1" title="Dismiss welcome guide">✕ Dismiss</button>
      </div>
      <div class="slx-gg-welcome-steps">
        ${spec.quickSteps
          .map(
            (st) => `
            <div class="slx-gg-welcome-step">
              <div class="slx-gg-welcome-step-hdr">
                <span class="slx-gg-welcome-num">${st.num}</span>
                <span>${st.title}</span>
              </div>
              <div>${st.body}</div>
            </div>`
          )
          .join('')}
      </div>
      <div class="slx-gg-welcome-ftr">
        <span class="slx-gg-welcome-note">💡 Live <strong>🧭 NEXT STEP</strong> hints below will guide you through every turn.</span>
        <div class="slx-gg-btn-row">
          <button type="button" class="slx-gg-btn slx-gg-btn-ghost" data-gg-open-full="1">📖 Full Field Manual &amp; Stats</button>
          <button type="button" class="slx-gg-btn slx-gg-btn-cta" data-gg-start="1">${spec.welcomePrimaryLabel}</button>
        </div>
      </div>
    `;
    welcomeMountEl.prepend(welcomeCard);

    const dismissWelcome = (runPrimary) => {
      welcomeVisible = false;
      markGameWelcomeSeen(gameId);
      welcomeCard.classList.add('slx-hidden');
      if (typeof onLayoutChange === 'function') onLayoutChange();
      if (runPrimary && typeof onWelcomePrimaryAction === 'function') {
        onWelcomePrimaryAction();
      }
    };

    welcomeCard.querySelector('[data-gg-dismiss]')?.addEventListener('click', () => dismissWelcome(false));
    welcomeCard.querySelector('[data-gg-start]')?.addEventListener('click', () => dismissWelcome(true));
    welcomeCard.querySelector('[data-gg-open-full]')?.addEventListener('click', () => openModal('controls'));
  }

  backdrop.querySelector('[data-gg-reshow]')?.addEventListener('click', () => {
    closeModal();
    if (welcomeCard) {
      welcomeVisible = true;
      welcomeCard.classList.remove('slx-hidden');
      if (typeof onLayoutChange === 'function') onLayoutChange();
      welcomeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  // 4. Live Contextual "NEXT STEP" Coach Bar
  let coachBar = null;
  let currentActionHandler = null;
  let lastCoachSig = '';

  if (coachMountEl) {
    coachBar = document.createElement('div');
    coachBar.className = 'slx-gg-coach';
    coachBar.setAttribute('data-tone', 'info');
    coachBar.innerHTML = `
      <div class="slx-gg-coach-left">
        <span class="slx-gg-coach-pill" data-coach-pill="1">🧭 NEXT STEP</span>
        <span class="slx-gg-coach-text" data-coach-text="1">Connecting to live Subnet 1 game state…</span>
      </div>
      <div class="slx-gg-coach-right">
        <button type="button" class="slx-gg-coach-action" data-coach-act="1" style="display:none;"></button>
        <button type="button" class="slx-gg-coach-help" data-coach-help="1">📖 Guide</button>
      </div>
    `;
    coachMountEl.prepend(coachBar);

    coachBar.querySelector('[data-coach-act]')?.addEventListener('click', () => {
      if (typeof currentActionHandler === 'function') currentActionHandler();
    });
    coachBar.querySelector('[data-coach-help]')?.addEventListener('click', () => openModal('controls'));
  }

  function updateCoach({
    pill = '🧭 NEXT STEP',
    html = '',
    tone = 'info',
    actionLabel = '',
    onAction = null,
  } = {}) {
    if (!coachBar) return;
    currentActionHandler = onAction;
    const sig = `${tone}|${pill}|${html}|${actionLabel}`;
    if (sig === lastCoachSig) return;
    lastCoachSig = sig;

    coachBar.setAttribute('data-tone', tone);
    const pillEl = coachBar.querySelector('[data-coach-pill]');
    const textEl = coachBar.querySelector('[data-coach-text]');
    const actEl = coachBar.querySelector('[data-coach-act]');
    if (pillEl) pillEl.textContent = pill;
    if (textEl) textEl.innerHTML = html;
    if (actEl) {
      if (actionLabel && typeof onAction === 'function') {
        actEl.textContent = actionLabel;
        actEl.style.display = 'inline-flex';
      } else {
        actEl.style.display = 'none';
      }
    }
  }

  return {
    openModal,
    closeModal,
    updateCoach,
    isWelcomeVisible: () => welcomeVisible,
  };
}
