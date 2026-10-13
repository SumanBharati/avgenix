'use client';

import { useState } from 'react';
import { CalcSection, InputField, SelectField, ResultCard, CalcPageWrapper } from '@/components/calc';
import {
  calculateDanteBandwidth,
  formatMbps,
  AES67_PACKET_TIMES_MS,
  type DanteTransport,
} from '@/lib/dante-bandwidth';

export default function DanteBandwidthPage() {
  const [transport, setTransport] = useState<DanteTransport>('unicast');
  const [channels, setChannels] = useState(64);
  const [sampleRate, setSampleRate] = useState('48000');
  const [bitDepth, setBitDepth] = useState('24');
  const [receivers, setReceivers] = useState(1);
  const [redundancy, setRedundancy] = useState('no');
  const [aes67PacketTime, setAes67PacketTime] = useState(String(AES67_PACKET_TIMES_MS[2]));

  const result = calculateDanteBandwidth({
    transport,
    channels,
    sampleRateHz: parseInt(sampleRate, 10),
    bitDepth: parseInt(bitDepth, 10),
    receivers,
    redundant: redundancy === 'yes',
    aes67PacketTimeMs: parseFloat(aes67PacketTime),
  });

  const isUnicast = transport === 'unicast';
  const isMulticast = transport === 'multicast';
  const isAes67 = transport === 'aes67';
  const isRedundant = redundancy === 'yes';

  return (
    <CalcPageWrapper
      title="Dante Bandwidth"
      desc="Native Dante (unicast/multicast) and AES67 bandwidth & flow-planning calculator"
      subtitle="Planning estimate based on Audinate's published rule-of-thumb figures — not a packet-capture measurement."
    >
      <div className="flex flex-col items-stretch gap-6 xl:flex-row">

        {/* ── Left column: Inputs + Results, stacked ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 rounded-xl border border-border bg-forge-surface/50 p-5">
            <CalcSection title="Inputs">
              <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                <SelectField label="Transport" value={transport} onChange={v => setTransport(v as DanteTransport)} options={[
                  { value: 'unicast', label: 'Dante Native — Unicast' },
                  { value: 'multicast', label: 'Dante Native — Multicast' },
                  { value: 'aes67', label: 'AES67' },
                ]} />
                <InputField label="Audio Channels" value={channels} onChange={setChannels} unit="ch" min={1} max={512} />
                <SelectField label="Sample Rate" value={sampleRate} onChange={setSampleRate} options={[
                  { value: '44100', label: '44.1 kHz' },
                  { value: '48000', label: '48 kHz' },
                  { value: '88200', label: '88.2 kHz' },
                  { value: '96000', label: '96 kHz' },
                  { value: '176400', label: '176.4 kHz' },
                  { value: '192000', label: '192 kHz' },
                ]} />
                <SelectField label="Bit Depth" value={bitDepth} onChange={setBitDepth} options={[
                  { value: '16', label: '16-bit' },
                  { value: '24', label: '24-bit' },
                  { value: '32', label: '32-bit' },
                ]} />

                {isAes67 && (
                  <SelectField label="AES67 Packet Time" value={aes67PacketTime} onChange={setAes67PacketTime} options={
                    AES67_PACKET_TIMES_MS.map(t => ({ value: String(t), label: `${t} ms` }))
                  } />
                )}
                {isUnicast && (
                  <InputField label="Receiving Devices" value={receivers} onChange={setReceivers} unit="" min={1} max={128} />
                )}
                {!isUnicast && (
                  <p className="text-[12px] leading-snug text-subtle sm:col-span-2 sm:-mt-2 sm:mb-2">
                    {isMulticast
                      ? 'Multicast is one-to-many — additional receivers don’t cause the transmitter to send another copy of the stream.'
                      : 'AES67 is RTP multicast — additional receivers don’t cause the transmitter to send another copy of the stream.'}
                  </p>
                )}

                <SelectField label="Redundant Network" value={redundancy} onChange={setRedundancy} options={[
                  { value: 'no', label: 'No — Primary only' },
                  { value: 'yes', label: 'Yes — Primary + Secondary' },
                ]} />
                {isUnicast && (
                  <p className="text-[12px] leading-snug text-subtle sm:col-span-2 sm:-mt-2">
                    Each unicast destination requires its own Dante transmit flow(s).
                  </p>
                )}
              </div>
            </CalcSection>
          </div>

          <div className="mt-6 rounded-xl border border-border bg-forge-surface/50 p-5">
            <CalcSection title="Results">
              <div className="grid grid-cols-2 gap-2.5">
                {isUnicast && (
                  <>
                    <ResultCard label="Required TX Flows" value={result.totalTransmitFlows ?? 0} unit="" accent />
                    <ResultCard label="Bandwidth / Receiver" value={formatMbps(result.bandwidthPerReceiver)} unit="Mbps" accent />
                  </>
                )}
                {isMulticast && (
                  <ResultCard label="TX Flows" value="Varies by device" unit="" accent />
                )}
                {isAes67 && (
                  <ResultCard label="AES67 Flows" value={result.aes67Flows ?? 0} unit="" accent />
                )}

                <ResultCard label="Primary Network" value={formatMbps(result.primaryMbps)} unit="Mbps" accent />
                <ResultCard label="Primary Utilization" value={result.primaryUtilizationPercent.toFixed(1)} unit={`% of ${result.recommendedLink.label}`} />

                {isRedundant && (
                  <>
                    <ResultCard label="Secondary Network" value={formatMbps(result.secondaryMbps)} unit="Mbps" accent />
                    <ResultCard label="Secondary Utilization" value={result.secondaryUtilizationPercent.toFixed(1)} unit={`% of ${result.recommendedLink.label}`} />
                  </>
                )}

                <ResultCard label="Recommended Link" value={result.recommendedLink.label} unit="" />
              </div>

              {isRedundant && (
                <div className="mt-2.5 rounded-md border border-border bg-forge-surface/30 px-3 py-2 text-[12px] text-subtle">
                  Aggregate across both networks: <strong className="text-body">{formatMbps(result.aggregateMbps)} Mbps</strong> — a sum for reference, not a single-link utilization figure.
                </div>
              )}

              {result.recommendedLink.mbps > 1000 && (
                <div className="mt-2.5 rounded-md border border-border bg-forge-surface/30 px-3 py-2 text-[12px] text-subtle">
                  A {result.recommendedLink.label} recommendation describes the switch uplink/trunk this traffic needs — not necessarily what an individual Dante endpoint's own NIC supports, which depends on the specific device.
                </div>
              )}

              {result.showFanoutAdvisory && (
                <div className="mt-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-400">
                  Multiple receivers increase Dante unicast fanout and transmit-flow usage. Consider multicast when the same channels are required by several receivers.
                </div>
              )}

              {(isMulticast || isAes67) && (
                <div className="mt-2.5 rounded-md border border-blue-500/25 bg-blue-500/[0.08] px-3 py-2 text-[12px] text-blue-400">
                  {isMulticast ? 'Multicast' : 'AES67'} bandwidth shown is transmitter/source traffic. Actual bandwidth on individual switch links depends on network topology and IGMP snooping. Without appropriate multicast management, multicast traffic may propagate more widely through the network.
                  {isMulticast && ' Multicast flow channel capacity varies by Dante device.'}
                </div>
              )}
            </CalcSection>
          </div>
        </div>

        {/* ── Right column: Calculation Guidelines ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 rounded-xl border border-border bg-forge-surface/50 p-5">
            <CalcSection title="Calculation Guidelines">
              <ul className="list-disc space-y-2 pl-4 text-[12px] leading-relaxed text-subtle">
                <li>A standard Dante unicast flow can carry up to 4 audio channels to one receiving device.</li>
                <li>At 48 kHz / 24-bit, use approximately 1.5 Mbps per audio channel or 6 Mbps for a full 4-channel flow for planning.</li>
                <li>With unicast, each receiver gets its own audio stream, so total transmit bandwidth increases as more receivers are added.</li>
                <li>With multicast, one audio stream is shared with multiple receivers, so adding receivers does not increase the source transmit bandwidth.</li>
                <li>Dante Primary and Secondary networks carry the same traffic on separate network interfaces; calculate utilization for each network independently.</li>
                <li>Link Utilization (%) = Estimated Bandwidth ÷ Link Capacity × 100</li>
                <li>Higher sample rates, such as 96 kHz or 192 kHz, increase bandwidth proportionally.</li>
                <li>Actual bandwidth and flow limits depend on the Dante device, routing, packetization, multicast configuration, and network topology.</li>
                <li>Results are intended for AV network design and capacity planning and should be treated as engineering estimates.</li>
              </ul>
            </CalcSection>
          </div>
        </div>

      </div>
    </CalcPageWrapper>
  );
}
