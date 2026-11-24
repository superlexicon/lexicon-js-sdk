/**
 * @superlexicon/sdk/ui/identity-security-ui
 *
 * Interactive UI controllers for:
 *  1. `📱 Devices & Shamir Recovery` tab inside `mountSlxWalletHeader` (`Identity` v4 Multi-Device Ring,
 *     `N`-Capped `GuardianKeychain` Blast-Radius Sharding, `2-of-3` Pedersen-VSS Shamir Setup,
 *     Timelock Veto `cancelRecovery()`, & Live Stateless Biometric Oracle + Passphrase Recovery).
 *  2. `🔐 ECIES` Multi-Topic Encrypted Channels subtab inside `mountSlxSocialWidgets`.
 */

import {
  hexToBytes,
  bytesToHex,
  generatePrivateKeyHex,
  deriveKeypairInfo,
} from '../crypto.js';
import { shortHex, truncAddr4, ZERO_ADDR } from '../abi.js';
import { SlxNonceQueue, SlxHfsCache, slxNodeRpc } from '../rpc.js';
import { slxWaitForReceipt } from '../events.js';
import { wrapSecretForRecipientSecp } from '../confidential.js';
import {
  DEV_STATUS_ACTIVE,
  SLOT_STATUS_ACTIVE,
  SLOT_STATUS_SEALED_FULL,
  SHARE_KIND_GUARDIAN_SLOT,
  SHARE_KIND_DIRECT_EOA,
  SHARE_KIND_SELF_PASSPHRASE,
  REC_STATUS_COLLECTING,
  REC_STATUS_TIMELOCKED,
  GUARDIAN_SHARE_WRAP_TAG,
  IdentityV4RecoveryAbi,
  resolveIdentityEncryptionKeys,
  wrapMasterSeedForDevice,
  encryptShareWithPassphrase,
  decryptShareWithPassphrase,
  splitSecretPedersenVss,
  packConfiguredShamirShares,
  proveBlindedRecoveryShare,
  unblindAndRecoverMasterSeed,
  deriveRecoverySessionKeypair,
  buildStatelessOracleRecoverySubmission,
  decodeOwnerDevicesHex,
  decodeGuardianSlotDescriptorHex,
  decodeGuardianKeychainHex,
  decodeRecoveryStateHex,
} from '../recovery.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendSignedChecked(rpcUrl, nonceQueue, wallet, privateKey, to, data, extraTargets, fnLabel, gasLimit = 6_500_000n) {
  const sent = await nonceQueue.sendSigned({
    privateKey,
    to,
    data,
    gasLimit,
    extraTargets,
    label: fnLabel,
  });
  try {
    const rcpt = await slxWaitForReceipt((m, p) => slxNodeRpc(rpcUrl, m, p), sent.txHash, 18_000);
    if (!rcpt || rcpt.status !== '0x1') {
      throw new Error(`${fnLabel} reverted on Subnet 1 (${sent.txHash})`);
    }
    wallet?.recordExternalRpcTx?.({
      txHash: sent.txHash,
      rawTx: sent.rawTx,
      from: sent.senderAddr,
      to,
      contractLabel: 'IdentityV4',
      fnLabel,
      dataHex: data,
      blockNumber: Number(rcpt.blockNumber || 0),
      nonce: Number(sent.nonce),
    });
    return { txHash: sent.txHash, receipt: rcpt };
  } finally {
    nonceQueue.release(sent.senderAddr, sent.nonce);
  }
}

export function createIdentitySecurityTabController({
  wallet,
  getRpcUrl,
  setStatus,
  requestRender,
  onWalletSwitch,
}) {
  const nonceQueue = new SlxNonceQueue({ rpcUrlFn: getRpcUrl });
  const state = {
    loading: false,
    busy: false,
    devices: [],
    recState: null,
    myKeychain: [],
    oracleMeta: null,
    oracleKeychain: [],
    lastPairedDeviceJson: null,
    recoverTargetAddr: '',
    currentBlock: 0,
  };

  async function refresh() {
    state.loading = true;
    requestRender();
    try {
      const rpcUrl = getRpcUrl();
      const { manifest } = await SlxHfsCache.hydrateWithManifest().catch(() => ({ manifest: null }));
      state.oracleMeta = manifest?.recoveryOracle || null;

      const blkHex = await slxNodeRpc(rpcUrl, 'eth_blockNumber', []).catch(() => '0x0');
      state.currentBlock = Number(BigInt(blkHex || '0x0'));

      if (state.oracleMeta?.identityAddr) {
        const okHex = await slxNodeRpc(rpcUrl, 'eth_call', [
          { to: state.oracleMeta.identityAddr, data: IdentityV4RecoveryAbi.getGuardianKeychain() },
          'latest',
        ]).catch(() => '0x');
        state.oracleKeychain = decodeGuardianKeychainHex(okHex);
      } else {
        state.oracleKeychain = [];
      }

      const idRec = wallet.getIdentityRecord?.();
      if (idRec?.identityAddr) {
        const [devHex, recHex, gkHex] = await Promise.all([
          slxNodeRpc(rpcUrl, 'eth_call', [
            { to: idRec.identityAddr, data: IdentityV4RecoveryAbi.getOwnerDevices() },
            'latest',
          ]).catch(() => '0x'),
          slxNodeRpc(rpcUrl, 'eth_call', [
            { to: idRec.identityAddr, data: IdentityV4RecoveryAbi.getRecoveryState() },
            'latest',
          ]).catch(() => '0x'),
          slxNodeRpc(rpcUrl, 'eth_call', [
            { to: idRec.identityAddr, data: IdentityV4RecoveryAbi.getGuardianKeychain() },
            'latest',
          ]).catch(() => '0x'),
        ]);
        state.devices = decodeOwnerDevicesHex(devHex);
        state.recState = decodeRecoveryStateHex(recHex);
        state.myKeychain = decodeGuardianKeychainHex(gkHex);
      } else {
        state.devices = [];
        state.recState = null;
        state.myKeychain = [];
      }
    } catch (_) {}
    state.loading = false;
    requestRender();
  }

  function renderHtml() {
    const idRec = wallet.getIdentityRecord?.();
    const myEoa = wallet.keypair.address.toLowerCase();
    const activeDevices = state.devices.filter((d) => d.status === DEV_STATUS_ACTIVE);
    const rs = state.recState;
    const activeSess =
      rs?.session && (rs.session.status === REC_STATUS_COLLECTING || rs.session.status === REC_STATUS_TIMELOCKED)
        ? rs.session
        : null;

    const oracleSlotsHtml = state.oracleKeychain.length
      ? state.oracleKeychain
          .map((sl) => {
            const full = sl.status === SLOT_STATUS_SEALED_FULL || sl.assignedCount >= sl.maxCapacity;
            return `
              <div style="display:flex;align-items:center;justify-content:space-between;gap:0.45rem;padding:0.38rem 0.55rem;border-radius:0.45rem;background:#060c18;border:1px solid ${full ? 'rgba(245,158,11,0.5)' : 'rgba(52,211,153,0.4)'};font-family:monospace;font-size:0.69rem;">
                <div>
                  <strong style="color:${full ? '#fde68a' : '#6ee7b7'};">Slot #${sl.slotId} • ${esc(sl.label)}</strong>
                  <span style="color:#94a3b8;"> (${shortHex(sl.operatorEoa)})</span>
                </div>
                <span style="color:${full ? '#fbbf24' : '#7dd3fc'};font-weight:700;">
                  ${sl.assignedCount} / ${sl.maxCapacity} Wards ${full ? '• SEALED_FULL' : '• ACTIVE'}
                </span>
              </div>
            `;
          })
          .join('')
      : `<div style="font-size:0.71rem;color:#94a3b8;">No Stateless Biometric Oracle slots detected in manifest yet.</div>`;

    return `
      ${
        activeSess && idRec
          ? `
        <div class="slx-panel-box" style="border-color:rgba(244,63,94,0.75);background:rgba(76,5,25,0.35);">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;">
            <div>
              <strong style="color:#fda4af;font-size:0.82rem;">🚨 Active Recovery Session #${activeSess.sessionId} In Progress!</strong>
              <div style="font-size:0.71rem;color:#fecdd3;margin-top:2px;">
                New Device <code>${shortHex(activeSess.newOwnerEoa)}</code> (${esc(activeSess.label)}) • Shares: <strong>${activeSess.submittedCount}/${rs.threshold}</strong>
                ${activeSess.unlockBlock > 0 ? ` • Timelock Unlock Blk <strong>#${activeSess.unlockBlock}</strong> (Now #${state.currentBlock})` : ''}
              </div>
            </div>
            <button type="button" class="slx-mini-btn rose" id="slxSecVetoBtn" ${state.busy ? 'disabled' : ''}>
              🛑 Veto &amp; Cancel Recovery
            </button>
          </div>
        </div>
      `
          : ''
      }

      <div class="slx-panel-box">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;">
          <div>
            <strong style="color:#7dd3fc;font-size:0.83rem;">📱 Multi-Device Owner Key Ring (<code>Identity</code> v4)</strong>
            <div style="font-size:0.7rem;color:#94a3b8;margin-top:2px;">
              Authorize multiple self-managed device keypairs (laptop, phone, radio slate) with per-device ECIES-wrapped encryption seeds so every device decrypts your channels &amp; payslips without sharing EOA signing keys.
            </div>
          </div>
          <button type="button" class="slx-mini-btn" id="slxSecRefreshBtn">${state.loading ? '⏳ Syncing…' : '↻ Sync'}</button>
        </div>

        ${
          !idRec
            ? `
          <div style="font-size:0.73rem;color:#cbd5e1;">
            Already added this keypair (<code>${shortHex(myEoa)}</code>) as a secondary device on an existing Identity HFS? Link it below:
          </div>
          <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
            <input id="slxSecBindIdInput" type="text" class="slx-input-field" placeholder="0x… Existing Identity HFS Address" value="${esc(state.recoverTargetAddr)}" />
            <button type="button" class="slx-mini-btn emerald" id="slxSecBindIdBtn" ${state.busy ? 'disabled' : ''}>🔗 Link Multi-Device Identity</button>
          </div>
        `
            : `
          <div style="display:flex;flex-direction:column;gap:0.38rem;max-height:175px;overflow-y:auto;">
            ${state.devices
              .map((d) => {
                const isMe = d.eoa === myEoa;
                const isAct = d.status === DEV_STATUS_ACTIVE;
                return `
                  <div class="slx-hfs-row ${isAct ? 'valid' : 'blocked'}">
                    <div style="display:flex;flex-direction:column;gap:2px;">
                      <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                        <strong>${isAct ? '📱' : '🚫'} ${esc(d.label || 'Device')}</strong>
                        ${isMe ? `<span style="padding:0.08rem 0.38rem;border-radius:999px;background:rgba(14,165,233,0.22);color:#7dd3fc;font-family:monospace;font-size:0.63rem;">THIS DEVICE</span>` : ''}
                        <span style="font-family:monospace;font-size:0.65rem;color:${isAct ? '#6ee7b7' : '#fda4af'};">${isAct ? 'ACTIVE' : 'REVOKED'}</span>
                        ${d.wrappedSeedBytes.length > 80 ? `<span style="font-family:monospace;font-size:0.63rem;color:#fcd34d;">🔑 ECIES Seed Wrapped</span>` : ''}
                      </div>
                      <div style="font-family:monospace;font-size:0.68rem;color:#94a3b8;">
                        EOA <code>${d.eoa}</code> • Added Blk #${d.addedBlock}
                      </div>
                    </div>
                    ${
                      isAct && activeDevices.length > 1
                        ? `<button type="button" class="slx-mini-btn rose" data-sec-revoke="${d.eoa}" ${state.busy ? 'disabled' : ''}>✕ Revoke</button>`
                        : ''
                    }
                  </div>
                `;
              })
              .join('')}
          </div>

          <div style="display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center;padding-top:0.25rem;border-top:1px solid rgba(71,85,105,0.35);">
            <input id="slxSecNewDevLabel" type="text" maxlength="28" class="slx-input-field" placeholder="New device label (e.g. Field Phone #2)" style="max-width:220px;" />
            <button type="button" class="slx-mini-btn emerald" id="slxSecGenPairBtn" ${state.busy ? 'disabled' : ''}>
              ⚡ Pair New Device Keypair (ECIES Seed Wrap)
            </button>
            ${
              state.lastPairedDeviceJson
                ? `<button type="button" class="slx-mini-btn sky" id="slxSecDownloadPairedBtn">⬇ Download Paired .json (${truncAddr4(state.lastPairedDeviceJson.address)})</button>
                   <button type="button" class="slx-mini-btn amber" id="slxSecSwitchPairedBtn">⇄ Switch to Paired Device</button>`
                : ''
            }
          </div>
        `
        }
      </div>

      <div class="slx-panel-box">
        <strong style="color:#6ee7b7;font-size:0.83rem;">🛡️ Unhackable Pedersen-VSS Shamir Key Recovery &amp; <code>N</code>-Capped Keychain</strong>
        <div style="font-size:0.7rem;color:#94a3b8;">
          Splits your 256-bit encryption seed via <code>2-of-3</code> Pedersen Verifiable Secret Sharing (<code>C_k = a_k·B + b_k·H_bp</code>). The Stateless Biometric Oracle holds <strong>zero database</strong> — it reads its 1-of-3 encrypted share from your <code>Identity</code> HFS and submits a <code>416 B</code> ECDH-blinded proof so neither validators nor the Oracle ever see your recovered key!
        </div>

        <div style="display:flex;flex-direction:column;gap:0.32rem;">
          <span class="slx-kv-label">Subnet 1 Stateless Biometric Oracle Keychain (<code>maxCapacity = N</code> Blast-Radius Sharding)</span>
          ${oracleSlotsHtml}
        </div>

        ${
          idRec
            ? `
          <div style="padding:0.52rem 0.65rem;border-radius:0.5rem;background:#060c18;border:1px solid rgba(56,189,248,0.35);font-family:monospace;font-size:0.7rem;">
            ${
              rs && rs.configEpoch > 0
                ? `<strong style="color:#6ee7b7;">✓ Configured (Epoch #${rs.configEpoch}):</strong> <strong>${rs.threshold}-of-${rs.shareCount}</strong> Pedersen-VSS • Timelock <strong>${rs.timelockBlocks} blks</strong><br/>
                   Shares: ${rs.shares.map((s) => `<span style="color:#bae6fd;">#${s.shareIdx} ${esc(s.label)}</span>`).join(' · ')}`
                : `<span style="color:#fcd34d;">Not yet configured on this Identity — set a Recovery Passphrase below to configure 2-of-3 Shamir Recovery in 1 click:</span>`
            }
          </div>
          <div style="display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center;">
            <input id="slxSecSetupPass" type="password" class="slx-input-field" placeholder="Recovery Passphrase (encrypts Share #2 via PBKDF2 + AES-256-GCM)" />
            <input id="slxSecTimelockInput" type="number" min="0" max="1000" value="2" class="slx-input-field" style="max-width:95px;min-width:80px;" title="Cancelable timelock blocks" />
            <button type="button" class="slx-mini-btn emerald" id="slxSecSetupShamirBtn" ${state.busy ? 'disabled' : ''}>
              🛡️ Configure 2-of-3 Shamir
            </button>
          </div>
        `
            : ''
        }

        <div style="padding-top:0.45rem;border-top:1px solid rgba(71,85,105,0.35);display:flex;flex-direction:column;gap:0.4rem;">
          <span class="slx-kv-label">🔑 Lost All Devices? Recover an Identity onto Current Keypair (<code>${shortHex(myEoa)}</code>)</span>
          <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
            <input id="slxSecRecIdAddr" type="text" class="slx-input-field" placeholder="0x… Ward Identity HFS to Recover" value="${esc(state.recoverTargetAddr || idRec?.identityAddr || '')}" style="min-width:185px;" />
            <input id="slxSecRecPass" type="password" class="slx-input-field" placeholder="Your Recovery Passphrase (Factor #2)" style="min-width:175px;" />
            <button type="button" class="slx-mini-btn sky" id="slxSecRunRecoveryBtn" ${state.busy ? 'disabled' : ''}>
              🧬 Biometric Oracle + Passphrase Recover
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function wireEvents(modalRoot) {
    modalRoot.querySelector('#slxSecRefreshBtn')?.addEventListener('click', () => refresh());

    modalRoot.querySelector('#slxSecBindIdBtn')?.addEventListener('click', async () => {
      const inp = modalRoot.querySelector('#slxSecBindIdInput');
      const addr = String(inp?.value || '').trim();
      if (!addr || state.busy) return;
      state.busy = true;
      setStatus(`⏳ Verifying multi-device ownership on ${shortHex(addr)}…`);
      requestRender();
      try {
        const rec = await wallet.bindExistingMultiDeviceIdentity(addr, { rpcUrl: getRpcUrl() });
        setStatus(`✓ Linked Multi-Device Identity "${rec.nickname}" (${shortHex(rec.identityAddr)})!`);
        if (onWalletSwitch) await onWalletSwitch(wallet.keypair);
        await refresh();
      } catch (err) {
        setStatus(`⚠ ${err?.message || err}`);
      } finally {
        state.busy = false;
        requestRender();
      }
    });

    modalRoot.querySelector('#slxSecGenPairBtn')?.addEventListener('click', async () => {
      const idRec = wallet.getIdentityRecord?.();
      if (!idRec?.identityAddr || state.busy) return;
      const lbl = String(modalRoot.querySelector('#slxSecNewDevLabel')?.value || 'Secondary Device').trim();
      state.busy = true;
      setStatus(`⏳ Wrapping Identity encryption seed via ECIES & authorizing "${lbl}" on-chain…`);
      requestRender();
      try {
        const rpcUrl = getRpcUrl();
        const myKeys = await resolveIdentityEncryptionKeys(rpcUrl, wallet.keypair.privateKey, idRec.identityAddr);

        // Ensure Device #0 also has its wrapped seed stored on-chain
        const myDevEntry = state.devices.find((d) => d.eoa === wallet.keypair.address.toLowerCase());
        if (!myDevEntry || myDevEntry.wrappedSeedBytes.length <= 80) {
          const selfWrap = wrapMasterSeedForDevice(myKeys.masterSeedBytes32, myKeys.deviceSecpPub64Bytes);
          await sendSignedChecked(
            rpcUrl,
            nonceQueue,
            wallet,
            wallet.keypair.privateKey,
            idRec.identityAddr,
            IdentityV4RecoveryAbi.updateDeviceWrappedSeed(
              wallet.keypair.address,
              myKeys.deviceSecpPub64Bytes,
              selfWrap
            ),
            [idRec.identityAddr],
            'updateDeviceWrappedSeed'
          );
        }

        const freshPriv = generatePrivateKeyHex();
        const freshKp = deriveKeypairInfo(freshPriv);
        const freshPub64 = hexToBytes(freshKp.uncompressedPubKey).slice(1, 65);
        const wrappedForNew = wrapMasterSeedForDevice(myKeys.masterSeedBytes32, freshPub64);

        await sendSignedChecked(
          rpcUrl,
          nonceQueue,
          wallet,
          wallet.keypair.privateKey,
          idRec.identityAddr,
          IdentityV4RecoveryAbi.addOwnerDevice(freshKp.address, freshPub64, lbl, wrappedForNew),
          [idRec.identityAddr],
          `addOwnerDevice("${lbl}")`
        );

        state.lastPairedDeviceJson = {
          protocol: 'SuperLexicon-HFS-Wallet-v1',
          address: freshKp.address,
          compressedPublicKey: freshKp.compressedPubKey,
          privateKey: freshKp.privateKey,
          identity: idRec,
          deviceLabel: lbl,
          exportedAt: new Date().toISOString(),
        };
        setStatus(`✓ Paired "${lbl}" (${shortHex(freshKp.address)}) with ECIES-wrapped Identity encryption seed!`);
        await refresh();
      } catch (err) {
        setStatus(`⚠ ${err?.message || err}`);
      } finally {
        state.busy = false;
        requestRender();
      }
    });

    modalRoot.querySelector('#slxSecDownloadPairedBtn')?.addEventListener('click', () => {
      if (!state.lastPairedDeviceJson) return;
      const blob = new Blob([JSON.stringify(state.lastPairedDeviceJson, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `superlexicon-paired-device-${truncAddr4(state.lastPairedDeviceJson.address)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

    modalRoot.querySelector('#slxSecSwitchPairedBtn')?.addEventListener('click', async () => {
      if (!state.lastPairedDeviceJson) return;
      const switched = wallet.importPrivateKey(JSON.stringify(state.lastPairedDeviceJson));
      setStatus(`✓ Switched active browser keypair to paired device ${shortHex(switched.address)}!`);
      if (onWalletSwitch) await onWalletSwitch(switched);
      await refresh();
    });

    modalRoot.querySelectorAll('[data-sec-revoke]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const targetEoa = btn.getAttribute('data-sec-revoke');
        const idRec = wallet.getIdentityRecord?.();
        if (!targetEoa || !idRec?.identityAddr || state.busy) return;
        state.busy = true;
        setStatus(`⏳ Revoking device ${shortHex(targetEoa)} from Identity HFS…`);
        requestRender();
        try {
          await sendSignedChecked(
            getRpcUrl(),
            nonceQueue,
            wallet,
            wallet.keypair.privateKey,
            idRec.identityAddr,
            IdentityV4RecoveryAbi.removeOwnerDevice(targetEoa),
            [idRec.identityAddr],
            'removeOwnerDevice'
          );
          setStatus(`✓ Revoked device ${shortHex(targetEoa)}!`);
          await refresh();
        } catch (err) {
          setStatus(`⚠ ${err?.message || err}`);
        } finally {
          state.busy = false;
          requestRender();
        }
      });
    });

    modalRoot.querySelector('#slxSecSetupShamirBtn')?.addEventListener('click', async () => {
      const idRec = wallet.getIdentityRecord?.();
      const pass = String(modalRoot.querySelector('#slxSecSetupPass')?.value || '').trim();
      const timelock = Math.max(0, Number(modalRoot.querySelector('#slxSecTimelockInput')?.value || 2));
      if (!idRec?.identityAddr || state.busy) return;
      if (pass.length < 6) {
        setStatus('⚠ Enter a Recovery Passphrase of at least 6 characters.');
        requestRender();
        return;
      }
      state.busy = true;
      setStatus('⏳ Computing 2-of-3 Pedersen-VSS commitments & allocating N-capped Biometric Oracle slot…');
      requestRender();
      try {
        const rpcUrl = getRpcUrl();
        const myKeys = await resolveIdentityEncryptionKeys(rpcUrl, wallet.keypair.privateKey, idRec.identityAddr);
        const vss = splitSecretPedersenVss(myKeys.masterSeedBytes32, 2, 3);

        const extraTargets = [idRec.identityAddr];
        let share0Spec;
        if (state.oracleMeta?.identityAddr) {
          const previewHex = await slxNodeRpc(rpcUrl, 'eth_call', [
            {
              to: state.oracleMeta.identityAddr,
              data: IdentityV4RecoveryAbi.previewAvailableGuardianSlot(idRec.identityAddr),
            },
            'latest',
          ]);
          const slotDesc = decodeGuardianSlotDescriptorHex(previewHex);
          if (!slotDesc) throw new Error('All Biometric Oracle GuardianKeychain slots are full');
          const env0 = wrapSecretForRecipientSecp(
            vss.shares[0].plainShare128,
            slotDesc.secpPub64Bytes,
            GUARDIAN_SHARE_WRAP_TAG
          );
          share0Spec = {
            shareKind: SHARE_KIND_GUARDIAN_SLOT,
            guardianIdentity: state.oracleMeta.identityAddr,
            slotId: slotDesc.slotId,
            operatorEoa: slotDesc.operatorEoa,
            recipientSecpPub64: slotDesc.secpPub64Bytes,
            label: `Biometric Oracle Slot #${slotDesc.slotId}`,
            encryptedEnvelope: env0,
          };
          extraTargets.push(state.oracleMeta.identityAddr);
        } else {
          const backupKp = deriveKeypairInfo(generatePrivateKeyHex());
          const backupPub64 = hexToBytes(backupKp.uncompressedPubKey).slice(1, 65);
          share0Spec = {
            shareKind: SHARE_KIND_DIRECT_EOA,
            guardianIdentity: ZERO_ADDR,
            slotId: 0,
            operatorEoa: backupKp.address,
            recipientSecpPub64: backupPub64,
            label: 'Hardware Guardian #1',
            encryptedEnvelope: wrapSecretForRecipientSecp(vss.shares[0].plainShare128, backupPub64, GUARDIAN_SHARE_WRAP_TAG),
          };
        }

        const friendKp = deriveKeypairInfo(generatePrivateKeyHex());
        const friendPub64 = hexToBytes(friendKp.uncompressedPubKey).slice(1, 65);
        const env1 = wrapSecretForRecipientSecp(
          vss.shares[1].plainShare128,
          friendPub64,
          GUARDIAN_SHARE_WRAP_TAG
        );
        const env2 = await encryptShareWithPassphrase(vss.shares[2].plainShare128, pass, idRec.identityAddr);

        const sharesPacked = packConfiguredShamirShares([
          share0Spec,
          {
            shareKind: SHARE_KIND_DIRECT_EOA,
            guardianIdentity: ZERO_ADDR,
            slotId: 0,
            operatorEoa: friendKp.address,
            recipientSecpPub64: friendPub64,
            label: 'Cold Backup Guardian',
            encryptedEnvelope: env1,
          },
          {
            shareKind: SHARE_KIND_SELF_PASSPHRASE,
            guardianIdentity: ZERO_ADDR,
            slotId: 0,
            operatorEoa: ZERO_ADDR,
            recipientSecpPub64: new Uint8Array(64),
            label: 'Self Passphrase (AES-256-GCM)',
            encryptedEnvelope: env2,
          },
        ]);

        await sendSignedChecked(
          rpcUrl,
          nonceQueue,
          wallet,
          wallet.keypair.privateKey,
          idRec.identityAddr,
          IdentityV4RecoveryAbi.configureShamirRecovery(2, timelock, vss.vssCommitsPacked, sharesPacked),
          extraTargets,
          'configureShamirRecovery(2-of-3)',
          7_500_000n
        );
        setStatus(`✓ 2-of-3 Pedersen-VSS Shamir Recovery active (${share0Spec.label} + Passphrase + Cold Guardian)!`);
        await refresh();
      } catch (err) {
        setStatus(`⚠ ${err?.message || err}`);
      } finally {
        state.busy = false;
        requestRender();
      }
    });

    modalRoot.querySelector('#slxSecVetoBtn')?.addEventListener('click', async () => {
      const idRec = wallet.getIdentityRecord?.();
      if (!idRec?.identityAddr || state.busy) return;
      state.busy = true;
      setStatus('⏳ Broadcasting owner cancelRecovery() veto…');
      requestRender();
      try {
        await sendSignedChecked(
          getRpcUrl(),
          nonceQueue,
          wallet,
          wallet.keypair.privateKey,
          idRec.identityAddr,
          IdentityV4RecoveryAbi.cancelRecovery(),
          [idRec.identityAddr],
          'cancelRecovery'
        );
        setStatus('🛑 Unauthorized recovery session cancelled on-chain!');
        await refresh();
      } catch (err) {
        setStatus(`⚠ ${err?.message || err}`);
      } finally {
        state.busy = false;
        requestRender();
      }
    });

    modalRoot.querySelector('#slxSecRunRecoveryBtn')?.addEventListener('click', async () => {
      const wardAddr = String(modalRoot.querySelector('#slxSecRecIdAddr')?.value || '').trim().toLowerCase();
      const pass = String(modalRoot.querySelector('#slxSecRecPass')?.value || '').trim();
      if (!/^0x[0-9a-f]{40}$/.test(wardAddr) || !pass || state.busy) {
        setStatus('⚠ Enter both the Ward Identity HFS address (0x…) and your Recovery Passphrase.');
        requestRender();
        return;
      }
      state.recoverTargetAddr = wardAddr;
      state.busy = true;
      requestRender();
      try {
        const rpcUrl = getRpcUrl();
        // If current keypair is ALREADY an active owner of `wardAddr`, auto-generate a fresh replacement device keypair!
        const devHexPre = await slxNodeRpc(rpcUrl, 'eth_call', [
          { to: wardAddr, data: IdentityV4RecoveryAbi.getOwnerDevices() },
          'latest',
        ]);
        const curDevs = decodeOwnerDevicesHex(devHexPre);
        if (curDevs.some((d) => d.status === DEV_STATUS_ACTIVE && d.eoa === wallet.keypair.address.toLowerCase())) {
          setStatus('⏳ Generating fresh Replacement Device keypair to demonstrate full lost-device recovery…');
          requestRender();
          wallet.generateNewKeypair();
        }

        const newDevPriv = wallet.keypair.privateKey;
        const sessKeys = deriveRecoverySessionKeypair(newDevPriv, wardAddr);

        setStatus(`⏳ [1/4] Initiating $0-gas recovery session onto fresh device ${shortHex(sessKeys.eoa)}…`);
        requestRender();
        await sendSignedChecked(
          rpcUrl,
          nonceQueue,
          wallet,
          newDevPriv,
          wardAddr,
          IdentityV4RecoveryAbi.initiateRecovery(
            sessKeys.eoa,
            sessKeys.secpPub64Bytes,
            sessKeys.edPub32Hex,
            'Recovered Browser Device'
          ),
          [wardAddr],
          'initiateRecovery'
        );

        const stHex1 = await slxNodeRpc(rpcUrl, 'eth_call', [
          { to: wardAddr, data: IdentityV4RecoveryAbi.getRecoveryState() },
          'latest',
        ]);
        const rs1 = decodeRecoveryStateHex(stHex1);
        const sessId = rs1.session?.sessionId;
        if (!sessId) throw new Error('Recovery session failed to initialize');

        // Factor 1: Stateless Biometric `[SIM-BOT]` Oracle reads share from `wardAddr` HFS & submits blinded proof
        setStatus(`⏳ [2/4] Stateless Biometric Oracle verifying selfie+OTP & submitting 416B blinded share…`);
        requestRender();
        const oracleShare = rs1.shares.find((s) => s.shareKind === SHARE_KIND_GUARDIAN_SLOT);
        const slotKeyObj = state.oracleMeta?.slots?.find(
          (sl) => sl.operatorEoa?.toLowerCase() === oracleShare?.operatorEoa?.toLowerCase()
        );
        if (!oracleShare || !slotKeyObj?.privateKey) {
          throw new Error('Biometric Oracle SIM-BOT slot key not available in manifest for demo');
        }
        const oracleSub = await buildStatelessOracleRecoverySubmission(rpcUrl, slotKeyObj.privateKey, wardAddr);
        await sendSignedChecked(
          rpcUrl,
          nonceQueue,
          null,
          slotKeyObj.privateKey,
          wardAddr,
          oracleSub.calldataHex,
          [wardAddr],
          `oracleSubmitRecoveryShare(#${oracleSub.shareIdx})`
        );

        // Factor 2: Decrypt Passphrase Share locally & submit 416B blinded proof
        setStatus(`⏳ [3/4] Decrypting Passphrase share locally & submitting 2nd 416B Pedersen-VSS proof…`);
        requestRender();
        const passShare = rs1.shares.find((s) => s.shareKind === SHARE_KIND_SELF_PASSPHRASE);
        if (!passShare) throw new Error('No Self-Passphrase share configured on this Identity');
        const plainPassShare128 = await decryptShareWithPassphrase(passShare.envelopeBytes, pass, wardAddr);
        const passProof = proveBlindedRecoveryShare({
          identityAddr: wardAddr,
          sessionId: sessId,
          shareIdx: passShare.shareIdx,
          newOwnerEoa: sessKeys.eoa,
          newDeviceEdPub32: sessKeys.edPub32Bytes,
          p0Bytes: passShare.p0Bytes,
          p1Bytes: passShare.p1Bytes,
          plainShare128: plainPassShare128,
        });
        await sendSignedChecked(
          rpcUrl,
          nonceQueue,
          wallet,
          newDevPriv,
          wardAddr,
          IdentityV4RecoveryAbi.submitRecoveryShare(sessId, passShare.shareIdx, passProof.proofBytes),
          [wardAddr],
          `submitRecoveryShare(#${passShare.shareIdx})`
        );

        // Read blinded shares back, unblind & Lagrange-interpolate 256-bit `masterSeedBytes32` in local RAM!
        const stHex2 = await slxNodeRpc(rpcUrl, 'eth_call', [
          { to: wardAddr, data: IdentityV4RecoveryAbi.getRecoveryState() },
          'latest',
        ]);
        const rs2 = decodeRecoveryStateHex(stHex2);
        const { masterSeedBytes32 } = unblindAndRecoverMasterSeed({
          identityAddr: wardAddr,
          sessionId: sessId,
          newDeviceEdSecretScalar: sessKeys.edSecretScalar,
          newDeviceEdPub32: sessKeys.edPub32Bytes,
          threshold: rs2.threshold,
          submittedShares: rs2.shares,
        });

        // Wait for timelock blocks if needed
        const unlockBlk = rs2.session?.unlockBlock || 0;
        for (let waitIter = 0; waitIter < 20; waitIter++) {
          const bHex = await slxNodeRpc(rpcUrl, 'eth_blockNumber', []);
          const curB = Number(BigInt(bHex || '0x0'));
          if (curB >= unlockBlk) break;
          setStatus(`⏳ [4/4] Seed reconstructed in RAM! Waiting for security timelock Blk #${curB} → #${unlockBlk}…`);
          requestRender();
          await new Promise((r) => setTimeout(r, 1200));
        }

        const wrappedForReplacement = wrapMasterSeedForDevice(masterSeedBytes32, sessKeys.secpPub64Bytes);
        await sendSignedChecked(
          rpcUrl,
          nonceQueue,
          wallet,
          newDevPriv,
          wardAddr,
          IdentityV4RecoveryAbi.finalizeRecovery(sessId, true, wrappedForReplacement),
          [wardAddr],
          'finalizeRecovery'
        );

        const bound = await wallet.bindExistingMultiDeviceIdentity(wardAddr, { rpcUrl });
        setStatus(
          `🎉 Recovered "${bound.nickname}" (${shortHex(wardAddr)}) onto ${shortHex(sessKeys.eoa)} with zero key leakage!`
        );
        if (onWalletSwitch) await onWalletSwitch(wallet.keypair);
        await refresh();
      } catch (err) {
        setStatus(`⚠ ${err?.message || err}`);
      } finally {
        state.busy = false;
        requestRender();
      }
    });
  }

  return {
    state,
    refresh,
    renderHtml,
    wireEvents,
  };
}

// ============================================================================
// 2. Universal `🔐 ECIES` Multi-Topic Channels Subtab Helper
// ============================================================================

export function renderEciesSubtabBarHtml(client, myIdLow) {
  const chans = client.eciesChannels || [];
  const activeCh = chans.find((c) => c.channelId === client.activeEciesChannelId) || null;
  const citizens = (client.charterSnap?.members || []).filter((m) => m.identityAddr !== myIdLow);
  const allies = [...client.connectedIds].filter((id) => id !== myIdLow);
  const candidateIds = [...new Set([...allies, ...citizens.map((c) => c.identityAddr)])];

  return `
    <div style="display:flex;flex-direction:column;gap:0.42rem;width:100%;">
      <div style="display:flex;gap:0.35rem;align-items:center;flex-wrap:wrap;">
        <select data-ecies="chanSelect" class="slx-input-field" style="min-width:0;flex:1;padding:0.28rem 0.45rem;font-size:0.7rem;">
          ${
            chans.length === 0
              ? `<option value="">No ECIES channels yet — open a 1:1 or group channel below</option>`
              : chans
                  .map((c) => {
                    const peerTags = c.members
                      .filter((m) => m !== myIdLow)
                      .map((m) => client.resolveDisplayTag(m))
                      .join(', ');
                    const title = c.label ? `${c.label} (${peerTags || 'Solo'})` : peerTags || shortHex(c.channelId);
                    const sel = c.channelId === client.activeEciesChannelId ? 'selected' : '';
                    return `<option value="${esc(c.channelId)}" ${sel}>🔐 ${esc(title)} • Ep#${c.currentKeyEpoch} (${c.topicCount} topics)</option>`;
                  })
                  .join('')
          }
        </select>
        <button type="button" class="slx-mini-btn" data-ecies="toggleNew" title="Open 1:1 / M:N channel or add sub-topic">+ Channel / Topic</button>
      </div>

      <div data-ecies="newBox" style="display:${chans.length === 0 ? 'flex' : 'none'};flex-direction:column;gap:0.35rem;padding:0.48rem;border-radius:0.48rem;background:#050b16;border:1px solid rgba(56,189,248,0.4);">
        <div style="font-family:monospace;font-size:0.64rem;color:#7dd3fc;">
          Select 1+ Identities (re-selecting an existing group auto-reuses that channel &amp; creates a new Topic!):
        </div>
        <div style="display:flex;gap:0.28rem;flex-wrap:wrap;max-height:68px;overflow-y:auto;">
          ${
            candidateIds.length
              ? candidateIds
                  .map(
                    (id) => `
                <label style="display:inline-flex;align-items:center;gap:0.24rem;padding:0.15rem 0.42rem;border-radius:999px;background:#0f192d;border:1px solid rgba(100,116,139,0.5);font-size:0.65rem;cursor:pointer;">
                  <input type="checkbox" data-ecies-peer="${esc(id)}" style="margin:0;" />
                  <span>${esc(client.resolveDisplayTag(id))}</span>
                </label>
              `
                  )
                  .join('')
              : `<span style="font-size:0.66rem;color:#94a3b8;">Syncing Subnet 1 Identities…</span>`
          }
        </div>
        <div style="display:flex;gap:0.32rem;flex-wrap:wrap;">
          <input type="text" data-ecies="newLabel" class="slx-input-field" maxlength="32" placeholder="Channel label (optional)" style="min-width:110px;padding:0.26rem 0.45rem;font-size:0.68rem;" />
          <input type="text" data-ecies="newTopic" class="slx-input-field" maxlength="40" placeholder="Topic (e.g. General / Q4 Ops)" value="General" style="min-width:120px;padding:0.26rem 0.45rem;font-size:0.68rem;" />
          <button type="button" class="slx-mini-btn emerald" data-ecies="openBtn" style="padding:0.26rem 0.58rem;font-size:0.68rem;">🔐 Open</button>
        </div>
      </div>

      ${
        activeCh
          ? `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:0.35rem;flex-wrap:wrap;">
          <div style="display:flex;gap:0.28rem;flex-wrap:wrap;align-items:center;">
            ${activeCh.topics
              .map(
                (t) => `
              <button type="button" class="slx-mini-btn ${t.topicId === client.activeEciesTopicId ? 'sky' : ''}" data-ecies-topic="${t.topicId}" style="padding:0.16rem 0.45rem;font-size:0.64rem;">
                #${t.topicId} ${esc(t.title)} (${t.msgCount})
              </button>
            `
              )
              .join('')}
            <button type="button" class="slx-mini-btn" data-ecies="addTopicBtn" style="padding:0.16rem 0.42rem;font-size:0.63rem;" title="Create new sub-topic in this channel">+ Topic</button>
          </div>
          <div style="display:flex;gap:0.28rem;align-items:center;">
            <span style="font-family:monospace;font-size:0.62rem;color:${activeCh.rekeyRequired ? '#fbbf24' : '#6ee7b7'};">
              ${activeCh.rekeyRequired ? `⚠️ Rekey Pending → Ep#${activeCh.currentKeyEpoch + 1}` : `🔑 AES-256 Ep#${activeCh.currentKeyEpoch}`}
            </span>
            ${
              activeCh.isActiveMember
                ? `<button type="button" class="slx-mini-btn" data-ecies="rollKeyBtn" style="padding:0.15rem 0.4rem;font-size:0.62rem;" title="Generate &amp; wrap fresh AES-256-GCM key epoch">🔄 Roll Key</button>
                   <button type="button" class="slx-mini-btn rose" data-ecies="leaveBtn" style="padding:0.15rem 0.4rem;font-size:0.62rem;" title="Leave channel &amp; trigger mandatory rekey for survivors">🚪</button>`
                : `<span style="font-family:monospace;font-size:0.62rem;color:#fda4af;">Left</span>`
            }
          </div>
        </div>
      `
          : ''
      }
    </div>
  `;
}
