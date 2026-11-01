import { describe, expect, it } from 'vitest';

import { createEcbSource, readEcbHistory, type GetLike } from '../ecb';

/** The ECB's file as it is laid out (`eurofxref-hist-90d.xml`), three days of it. */
const HISTORY = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
	<gesmes:subject>Reference rates</gesmes:subject>
	<gesmes:Sender>
		<gesmes:name>European Central Bank</gesmes:name>
	</gesmes:Sender>
	<Cube>
		<Cube time='2025-10-03'>
			<Cube currency='USD' rate='1.1734'/>
			<Cube currency='JPY' rate='172.65'/>
			<Cube currency='GBP' rate='0.87210'/>
		</Cube>
		<Cube time='2025-10-02'>
			<Cube currency='USD' rate='1.1708'/>
			<Cube currency='JPY' rate='172.24'/>
		</Cube>
		<Cube time='2025-10-01'>
			<Cube currency='USD' rate='1.1741'/>
		</Cube>
	</Cube>
</gesmes:Envelope>`;

const answer = (body: string, init: ResponseInit = {}): Response =>
  new Response(body, { status: 200, ...init });

describe('the ECB’s file (ADR 0033)', () => {
  it('reads each day and the rates of the currencies pay uses, as written', () => {
    expect(readEcbHistory(HISTORY)).toEqual([
      { day: '2025-10-03', currency: 'USD', perEuro: '1.1734' },
      { day: '2025-10-02', currency: 'USD', perEuro: '1.1708' },
      { day: '2025-10-01', currency: 'USD', perEuro: '1.1741' },
    ]);
  });

  it('never lets an odd rate of a currency nobody is paid in stop the dollar', () => {
    const odd = HISTORY.replace("rate='172.65'", "rate='N/A'").replace("rate='0.87210'", "rate='16789012.5'");
    expect(readEcbHistory(odd)).toEqual(readEcbHistory(HISTORY));
    // The same value on the dollar refuses the whole file.
    expect(() => readEcbHistory(HISTORY.replace("rate='1.1708'", "rate='N/A'"))).toThrow();
    // A day and a currency code are checked everywhere, even on a day holding no rate pay uses.
    const yen = `<Cube><Cube time='2025-10-03'><Cube currency='USD' rate='1.1734'/></Cube>`;
    expect(() =>
      readEcbHistory(`${yen}<Cube time='03/10/2025'><Cube currency='JPY' rate='172'/></Cube></Cube>`),
    ).toThrow();
    expect(() =>
      readEcbHistory(`${yen}<Cube time='2025-10-02'><Cube currency='yen' rate='172'/></Cube></Cube>`),
    ).toThrow();
    expect(() => readEcbHistory(`${yen}<Cube time='2025-10-02'><Cube rate='172'/></Cube></Cube>`)).toThrow();
  });

  it('reads double quotes and attributes in any order', () => {
    const xml = `<Cube><Cube time="2025-10-03"><Cube rate="1.1734" currency="USD" /></Cube></Cube>`;
    expect(readEcbHistory(xml)).toEqual([{ day: '2025-10-03', currency: 'USD', perEuro: '1.1734' }]);
  });

  it('refuses a whole file with one value out of format, and a file without any rate', () => {
    for (const broken of [
      HISTORY.replace("rate='1.1708'", "rate='1,1708'"),
      HISTORY.replace("time='2025-10-02'", "time='02/10/2025'"),
      HISTORY.replace("currency='JPY' rate='172.65'", "currency='jpy' rate='172.65'"),
      HISTORY.replace("<Cube currency='USD' rate='1.1741'/>", "<Cube currency='USD'/>"),
      HISTORY.replace("time='2025-10-01'", 'time=2025-10-01'),
    ]) {
      expect(() => readEcbHistory(broken)).toThrow();
    }
    expect(() => readEcbHistory('<html><body>Maintenance</body></html>')).toThrow('no rate');
    expect(() => readEcbHistory("<Cube><Cube time='2025-10-03'></Cube></Cube>")).toThrow('no rate');
    expect(() =>
      readEcbHistory("<Cube><Cube time='2025-10-03'><Cube currency='JPY' rate='172'/></Cube></Cube>"),
    ).toThrow('no rate of a currency pay uses');
  });

  it('asks the ECB’s 90 days, with a deadline, and reads its answer', async () => {
    const asked: string[] = [];
    const fetch: GetLike = (url, init) => {
      asked.push(url);
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(answer(HISTORY));
    };
    expect(await createEcbSource({ fetch }).history()).toHaveLength(3);
    expect(asked).toEqual(['https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml']);
  });

  it('fails on another status, an answer too large, declared or read, and a deadline passed', async () => {
    const failing = (fetch: GetLike, options = {}) => createEcbSource({ fetch, ...options }).history();
    await expect(failing(() => Promise.resolve(answer('Busy', { status: 503 })))).rejects.toThrow('503');
    await expect(
      failing(() => Promise.resolve(answer(HISTORY, { headers: { 'content-length': '2000000' } }))),
    ).rejects.toThrow('too large');
    await expect(failing(() => Promise.resolve(answer(HISTORY)), { maxBytes: 100 })).rejects.toThrow(
      'too large',
    );
    const never: GetLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    await expect(failing(never, { timeoutMs: 20 })).rejects.toThrow('aborted');
  });
});
