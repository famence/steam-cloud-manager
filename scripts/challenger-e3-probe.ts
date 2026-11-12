import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';
import { DemoCloudDriver } from '../src/server/demo-driver.js';
import { archiveEntryName } from '../src/server/files.js';

function extractCookie(setCookie: string | string[] | undefined): string {
  if (!setCookie) throw new Error('Expected set-cookie header');
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return raw.split(';')[0].trim();
}

async function createTestApp(options: { clock?: () => number; sessionKey?: string } = {}) {
  const env: NodeJS.ProcessEnv = {
    APP_ORIGIN: 'http://127.0.0.1:3000',
    NODE_ENV: 'test',
  };
  if (options.sessionKey) env.SCM_SESSION_KEY = options.sessionKey;
  const config = readConfig(env);
  const app = await buildApp({
    config,
    now: options.clock ?? (() => Date.now()),
    logger: false,
    serveStatic: false,
  });
  return { app, config };
}

function createClient(app: any, defaultHeaders: Record<string, string> = {}) {
  const host = '127.0.0.1:3000';
  const origin = 'http://127.0.0.1:3000';
  let cookie: string | undefined;
  let csrf: string | undefined;

  function updateState(res: any) {
    const sc = res.headers['set-cookie'];
    if (sc) cookie = extractCookie(sc);
    try {
      const json = res.json();
      if (json && typeof json.csrfToken === 'string') {
        csrf = json.csrfToken;
      }
    } catch {
      // non-json
    }
  }

  return {
    get cookie() {
      return cookie;
    },
    set cookie(val: string | undefined) {
      cookie = val;
    },
    get csrf() {
      return csrf;
    },
    set csrf(val: string | undefined) {
      csrf = val;
    },
    host,
    origin,

    async get(url: string, headers: Record<string, string> = {}) {
      const res = await app.inject({
        method: 'GET',
        url,
        headers: {
          host,
          ...(cookie ? { cookie } : {}),
          ...defaultHeaders,
          ...headers,
        },
      });
      updateState(res);
      return res;
    },

    async post(url: string, payload: unknown = {}, headers: Record<string, string> = {}) {
      const res = await app.inject({
        method: 'POST',
        url,
        headers: {
          host,
          origin,
          ...(cookie ? { cookie } : {}),
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
          ...defaultHeaders,
          ...headers,
        },
        payload: payload as Record<string, unknown>,
      });
      updateState(res);
      return res;
    },

    async initSession() {
      return this.get('/api/session');
    },

    async demoLogin() {
      if (!cookie || !csrf) await this.initSession();
      return this.post('/api/auth/demo', {});
    },

    async logout() {
      return this.post('/api/auth/logout', {});
    },
  };
}

async function main() {
  console.log('================================================================');
  console.log('CHALLENGER E3.1: EMPIRICAL ADVERSARIAL VERIFICATION HARNESS');
  console.log('Testing Demo Mode Constraints, Security & Edge Cases');
  console.log('================================================================\n');

  let passedAssertions = 0;
  const recordPass = () => passedAssertions++;

  // --------------------------------------------------------------------------
  // PROBE 1: Deletion Confirmation Phrase Matching
  // --------------------------------------------------------------------------
  console.log('>>> PROBE 1: Deletion confirmation phrase matching & unicode/whitespace variations');
  {
    const { app } = await createTestApp();
    try {
      // Test A: English phrase variations
      const clientEn = createClient(app);
      await clientEn.demoLogin();

      const filesRes = await clientEn.get('/api/games/949230/files');
      const { revision } = filesRes.json();

      const planRes = await clientEn.post('/api/games/949230/delete-plan', {
        names: ['Settings.coc'],
        revision,
      });
      assert.equal(planRes.statusCode, 200);
      const { planId, confirmation } = planRes.json();
      assert.equal(confirmation, 'DELETE 1');
      recordPass();

      const invalidPhrasesEn = [
        // Case variations
        { label: 'lowercase', val: 'delete 1' },
        { label: 'titlecase', val: 'Delete 1' },
        { label: 'mixedcase', val: 'DeLeTe 1' },
        { label: 'uppercase-number-letter', val: 'DELETE ONE' },
        // Whitespace variations
        { label: 'leading-space', val: ' DELETE 1' },
        { label: 'trailing-space', val: 'DELETE 1 ' },
        { label: 'double-internal-space', val: 'DELETE  1' },
        { label: 'tab-separated', val: 'DELETE\t1' },
        { label: 'non-breaking-space-U+00A0', val: 'DELETE\u00A01' },
        { label: 'zero-width-space-U+200B', val: 'DELETE\u200B1' },
        { label: 'newline-separated', val: 'DELETE\n1' },
        // Unicode variations & homoglyphs
        { label: 'cyrillic-homoglyphs-E-T', val: 'D\u0415L\u0415\u0422\u0415 1' },
        { label: 'fullwidth-latin', val: 'ＤＥＬＥＴＥ １' },
        { label: 'combining-accent', val: 'DELETE 1\u0300' },
        // Count mismatches
        { label: 'wrong-count-0', val: 'DELETE 0' },
        { label: 'wrong-count-2', val: 'DELETE 2' },
        { label: 'empty-string', val: '' },
      ];

      for (const { label, val } of invalidPhrasesEn) {
        const res = await clientEn.post('/api/games/949230/delete', {
          planId,
          confirmation: val,
          gamesClosed: true,
        });
        assert.equal(
          res.statusCode,
          400,
          `Expected 400 for phrase variant '${label}', got ${res.statusCode}`,
        );
        assert.equal(res.json().error.code, 'CONFIRMATION_MISMATCH');
        recordPass();
      }

      // Valid English confirmation still succeeds after failed confirmation attempts
      const validDel = await clientEn.post('/api/games/949230/delete', {
        planId,
        confirmation: 'DELETE 1',
        gamesClosed: true,
      });
      assert.equal(validDel.statusCode, 200);
      assert.equal(validDel.json().batchCompleted, true);
      recordPass();

      // Test B: Russian locale phrase matching and variations
      const clientRu = createClient(app, { 'accept-language': 'ru-RU,ru;q=0.9' });
      await clientRu.demoLogin();

      const filesResRu = await clientRu.get('/api/games/1086940/files');
      const { revision: revRu } = filesResRu.json();

      const planResRu = await clientRu.post('/api/games/1086940/delete-plan', {
        names: ['Save_01.lsv'],
        revision: revRu,
      });
      assert.equal(planResRu.statusCode, 200);
      const { planId: planIdRu, confirmation: confRu } = planResRu.json();
      assert.equal(confRu, 'УДАЛИТЬ 1');
      recordPass();

      const invalidPhrasesRu = [
        { label: 'russian-lowercase', val: 'удалить 1' },
        { label: 'russian-titlecase', val: 'Удалить 1' },
        { label: 'russian-leading-space', val: ' УДАЛИТЬ 1' },
        { label: 'russian-trailing-space', val: 'УДАЛИТЬ 1 ' },
        { label: 'english-in-russian-plan', val: 'DELETE 1' },
        { label: 'russian-wrong-count', val: 'УДАЛИТЬ 2' },
      ];

      for (const { label, val } of invalidPhrasesRu) {
        const res = await clientRu.post('/api/games/1086940/delete', {
          planId: planIdRu,
          confirmation: val,
          gamesClosed: true,
        });
        assert.equal(res.statusCode, 400, `Expected 400 for ${label}`);
        assert.equal(res.json().error.code, 'CONFIRMATION_MISMATCH');
        recordPass();
      }

      const validDelRu = await clientRu.post('/api/games/1086940/delete', {
        planId: planIdRu,
        confirmation: 'УДАЛИТЬ 1',
        gamesClosed: true,
      });
      assert.equal(validDelRu.statusCode, 200);
      assert.equal(validDelRu.json().batchCompleted, true);
      recordPass();

      console.log('  ✔ PROBE 1 PASSED: Strict string matching rejects all unicode, homoglyph, whitespace and case variants in EN and RU.');
    } finally {
      await app.close();
    }
  }

  // --------------------------------------------------------------------------
  // PROBE 2: Export Ticket Strict Single-Use & Concurrency Race
  // --------------------------------------------------------------------------
  console.log('\n>>> PROBE 2: Export ticket reuse, replay race & single-use enforcement');
  {
    const { app } = await createTestApp();
    try {
      const client = createClient(app);
      await client.demoLogin();

      const filesRes = await client.get('/api/games/949230/files');
      const { revision } = filesRes.json();

      const exportRes = await client.post('/api/games/949230/exports', {
        names: ['Saves/Cedar Valley.cok'],
        revision,
      });
      assert.equal(exportRes.statusCode, 200);
      const { downloadUrl } = exportRes.json();
      recordPass();

      // Sequential check: 1st retrieval -> 200; 2nd -> 404; 3rd -> 404
      const res1 = await client.get(downloadUrl);
      assert.equal(res1.statusCode, 200);
      assert.equal(res1.headers['content-type'], 'application/zip');
      assert.equal(res1.rawPayload.subarray(0, 2).toString('latin1'), 'PK');
      recordPass();

      const res2 = await client.get(downloadUrl);
      assert.equal(res2.statusCode, 404);
      assert.equal(res2.json().error.code, 'EXPORT_EXPIRED');
      recordPass();

      const res3 = await client.get(downloadUrl);
      assert.equal(res3.statusCode, 404);
      assert.equal(res3.json().error.code, 'EXPORT_EXPIRED');
      recordPass();

      // Parallel race check: create fresh ticket and fire 10 simultaneous GET requests
      const exportRes2 = await client.post('/api/games/949230/exports', {
        names: ['Saves/Cedar Valley.cok'],
        revision,
      });
      const ticketUrl = exportRes2.json().downloadUrl;

      const racePromises = Array.from({ length: 10 }, () => client.get(ticketUrl));
      const raceResults = await Promise.all(racePromises);

      const status200s = raceResults.filter((r) => r.statusCode === 200);
      const status404s = raceResults.filter((r) => r.statusCode === 404);
      const status429s = raceResults.filter((r) => r.statusCode === 429);

      // Exactly ONE request must get 200 OK. The rest must get 404 or 429.
      assert.equal(status200s.length, 1, `Expected exactly 1 success in race, got ${status200s.length}`);
      assert.equal(status404s.length + status429s.length, 9, 'Remaining 9 must be 404 or 429');
      recordPass();

      // After race, ticket is permanently gone
      const postRace = await client.get(ticketUrl);
      assert.equal(postRace.statusCode, 404);
      recordPass();

      // Malformed tickets: invalid base64url regex or path traversal in ticket param
      const malformedTickets = [
        '/api/exports/../../etc/passwd',
        '/api/exports/short',
        '/api/exports/' + 'A'.repeat(42), // 42 chars instead of 43
        '/api/exports/' + 'A'.repeat(44), // 44 chars instead of 43
        '/api/exports/invalid!characters@not#base64url$$$$$$$$$$$$',
      ];
      for (const badUrl of malformedTickets) {
        const badRes = await client.get(badUrl);
        assert.ok([400, 404].includes(badRes.statusCode), `Malformed ticket must return 400/404, got ${badRes.statusCode}`);
        recordPass();
      }

      console.log('  ✔ PROBE 2 PASSED: Export tickets are strictly single-use; parallel race admits exactly 1 winner; replays strictly 404.');
    } finally {
      await app.close();
    }
  }

  // --------------------------------------------------------------------------
  // PROBE 3: Concurrency Cap (Max 2 Active Downloads, 3rd returns 429)
  // --------------------------------------------------------------------------
  console.log('\n>>> PROBE 3: Concurrency cap: 3rd concurrent download strictly 429 DOWNLOAD_LIMIT');
  {
    const { app } = await createTestApp();
    try {
      const client = createClient(app);
      await client.demoLogin();

      let releaseStreams!: () => void;
      const holdPromise = new Promise<void>((r) => {
        releaseStreams = r;
      });

      const origDownload = DemoCloudDriver.prototype.downloadFile;
      DemoCloudDriver.prototype.downloadFile = async function (appId, file) {
        const stream = new Readable({ read() {} });
        void holdPromise.then(() => {
          stream.push(Buffer.from('CHUNK'));
          stream.push(null);
        });
        return { stream, size: 5 };
      };

      try {
        // Start 2 concurrent single-file downloads
        const d1 = client.get('/api/games/949230/download?name=Saves/Cedar%20Valley.cok');
        const d2 = client.get('/api/games/949230/download?name=Settings.coc');

        await new Promise((r) => setImmediate(r));

        // 3rd concurrent single-file download MUST return 429 DOWNLOAD_LIMIT
        const d3 = await client.get('/api/games/949230/download?name=Saves/Old%20Town.cok');
        assert.equal(d3.statusCode, 429);
        assert.equal(d3.json().error.code, 'DOWNLOAD_LIMIT');
        recordPass();

        // 4th concurrent request (also while 2 are active) must also return 429
        const d4 = await client.get('/api/games/949230/download?name=Saves/Autosave-01.cok');
        assert.equal(d4.statusCode, 429);
        assert.equal(d4.json().error.code, 'DOWNLOAD_LIMIT');
        recordPass();

        // Cross-Session Concurrency Isolation:
        // Session B should NOT be blocked by Session A's active downloads!
        const clientB = createClient(app);
        await clientB.demoLogin();
        const dB_test = clientB.get('/api/games/1086940/download?name=Save_01.lsv');
        await new Promise((r) => setImmediate(r));

        // Session B's 1st download is admitted (not 429)
        // Session B's 2nd download is admitted
        const dB_test2 = clientB.get('/api/games/1086940/download?name=Save_02.lsv');
        await new Promise((r) => setImmediate(r));

        // Session B's 3rd download returns 429
        const dB_test3 = await clientB.get('/api/games/1086940/download?name=Save_01.lsv');
        assert.equal(dB_test3.statusCode, 429);
        recordPass();

        // Unblock all streams
        releaseStreams();
        const [r1, r2, rB1, rB2] = await Promise.all([d1, d2, dB_test, dB_test2]);
        assert.equal(r1.statusCode, 200);
        assert.equal(r2.statusCode, 200);
        assert.equal(rB1.statusCode, 200);
        assert.equal(rB2.statusCode, 200);
        recordPass();

        // After completion, transfer count drops to 0, subsequent download succeeds
        const dPost = await client.get('/api/games/949230/download?name=Saves/Cedar%20Valley.cok');
        assert.equal(dPost.statusCode, 200);
        recordPass();
      } finally {
        releaseStreams?.();
        DemoCloudDriver.prototype.downloadFile = origDownload;
      }

      console.log('  ✔ PROBE 3 PASSED: 3rd concurrent download strictly 429; concurrency counters isolated per session; recovers cleanly.');
    } finally {
      await app.close();
    }
  }

  // --------------------------------------------------------------------------
  // PROBE 4: Path Traversal, Catalog Bypass & Sanitization
  // --------------------------------------------------------------------------
  console.log('\n>>> PROBE 4: Path traversal & catalog bypass verification');
  {
    const { app } = await createTestApp();
    try {
      const client = createClient(app);
      await client.demoLogin();

      const traversalVectors = [
        '../../etc/passwd',
        '../../../etc/shadow',
        '..%2f..%2fetc%2fpasswd',
        '..%2e%2f..%2e%2fetc%2fpasswd',
        '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
        '%252e%252e%252fetc%252fpasswd',
        '/etc/passwd',
        '/var/run/secrets',
        'C:\\Windows\\System32\\cmd.exe',
        '..\\..\\..\\Windows\\win.ini',
        'Saves/../../etc/passwd',
        'Saves/./Cedar Valley.cok',
        'Saves/Cedar Valley.cok\0.txt',
        'Saves/Cedar Valley.cok%00.txt',
        // Cross-game save injection: request BG3 save under Cities Skylines AppID
        'Save_01.lsv',
        'ER0000.sl2',
      ];

      for (const vec of traversalVectors) {
        const res = await client.get(
          `/api/games/949230/download?name=${encodeURIComponent(vec)}`,
        );
        assert.equal(
          res.statusCode,
          404,
          `Vector '${vec}' must return 404 FILE_NOT_FOUND, got ${res.statusCode}`,
        );
        assert.equal(res.json().error.code, 'FILE_NOT_FOUND');
        recordPass();
      }

      // AppID parameter boundary & traversal
      const invalidAppIds = [
        '0',
        '-1',
        'abc',
        '..',
        '%2e%2e',
        '999999999999999999', // exceeds uint32 max
        '4294967296', // uint32 max + 1
      ];

      for (const badAppId of invalidAppIds) {
        const res = await client.get(`/api/games/${badAppId}/files`);
        assert.ok(
          [400, 404].includes(res.statusCode),
          `AppID '${badAppId}' must fail with 400 or 404, got ${res.statusCode}`,
        );
        recordPass();
      }

      // ZIP archive entry sanitization check
      const testFile1 = { name: '../../etc/passwd', size: 10, modifiedAt: 1000, sha: 'abc' };
      const testFile2 = { name: '..\\..\\windows\\system32', size: 10, modifiedAt: 1000, sha: 'abc' };
      const entry1 = archiveEntryName(testFile1, 0);
      const entry2 = archiveEntryName(testFile2, 1);
      assert.ok(!entry1.includes('..'), `archiveEntryName must not contain '..': ${entry1}`);
      assert.ok(entry1.startsWith('saves/0001-'), `entry1 must start with saves/0001-: ${entry1}`);
      assert.ok(!entry2.includes('..'), `archiveEntryName must not contain '..': ${entry2}`);
      assert.ok(entry2.startsWith('saves/0002-'), `entry2 must start with saves/0002-: ${entry2}`);
      recordPass();

      console.log('  ✔ PROBE 4 PASSED: Path traversal rejected at all levels; AppID bounded to uint32; ZIP paths sanitized.');
    } finally {
      await app.close();
    }
  }

  // --------------------------------------------------------------------------
  // PROBE 5: Session Bleed & Cross-Session Isolation
  // --------------------------------------------------------------------------
  console.log('\n>>> PROBE 5: Session isolation & zero cross-session mutation leak');
  {
    const { app } = await createTestApp();
    try {
      // Create Session A and Session B
      const clientA = createClient(app);
      const clientB = createClient(app);

      await clientA.demoLogin();
      await clientB.demoLogin();

      assert.notEqual(clientA.cookie, clientB.cookie);
      assert.notEqual(clientA.csrf, clientB.csrf);
      recordPass();

      // Step 1: Initial file counts are identical (6 saves in Cities Skylines)
      const filesA1 = await clientA.get('/api/games/949230/files');
      const filesB1 = await clientB.get('/api/games/949230/files');
      assert.equal(filesA1.json().files.length, 6);
      assert.equal(filesB1.json().files.length, 6);
      recordPass();

      // Step 2: Session A deletes 'Settings.coc'
      const { revision: revA } = filesA1.json();
      const planResA = await clientA.post('/api/games/949230/delete-plan', {
        names: ['Settings.coc'],
        revision: revA,
      });
      assert.equal(planResA.statusCode, 200);
      const { planId: planIdA } = planResA.json();

      const delResA = await clientA.post('/api/games/949230/delete', {
        planId: planIdA,
        confirmation: 'DELETE 1',
        gamesClosed: true,
      });
      assert.equal(delResA.statusCode, 200);

      // Verify Session A has 5 files now
      const filesA2 = await clientA.get('/api/games/949230/files');
      assert.equal(filesA2.json().files.length, 5);
      assert.ok(!filesA2.json().files.some((f: any) => f.name === 'Settings.coc'));
      recordPass();

      // CRITICAL CHECK: Does Session B still have all 6 files, including 'Settings.coc'?
      const filesB2 = await clientB.get('/api/games/949230/files');
      assert.equal(filesB2.json().files.length, 6, 'Session B MUST still have 6 files');
      assert.ok(
        filesB2.json().files.some((f: any) => f.name === 'Settings.coc'),
        'Settings.coc MUST still exist in Session B!',
      );
      recordPass();

      // Step 3: Plan Stealing Attack
      // Session A creates a delete plan for Cedar Valley.
      // Session B attempts to execute Session A's planId with Session B's credentials.
      const planResA2 = await clientA.post('/api/games/949230/delete-plan', {
        names: ['Saves/Cedar Valley.cok'],
        revision: filesA2.json().revision,
      });
      assert.equal(planResA2.statusCode, 200);
      const stolenPlanId = planResA2.json().planId;

      const attackDelRes = await clientB.post('/api/games/949230/delete', {
        planId: stolenPlanId,
        confirmation: 'DELETE 1',
        gamesClosed: true,
      });
      assert.equal(
        attackDelRes.statusCode,
        409,
        `Cross-session plan execution must return 409 PLAN_EXPIRED, got ${attackDelRes.statusCode}`,
      );
      assert.equal(attackDelRes.json().error.code, 'PLAN_EXPIRED');
      recordPass();

      // Step 4: Export Ticket Stealing Attack
      // Session A creates an export ticket.
      // Session B attempts to download Session A's export ticket.
      const exportResA = await clientA.post('/api/games/949230/exports', {
        names: ['Saves/Cedar Valley.cok'],
        revision: filesA2.json().revision,
      });
      assert.equal(exportResA.statusCode, 200);
      const stolenTicketUrl = exportResA.json().downloadUrl;

      const attackTicketRes = await clientB.get(stolenTicketUrl);
      assert.equal(
        attackTicketRes.statusCode,
        404,
        `Cross-session export ticket retrieval must return 404 EXPORT_EXPIRED, got ${attackTicketRes.statusCode}`,
      );
      assert.equal(attackTicketRes.json().error.code, 'EXPORT_EXPIRED');
      recordPass();

      // Session A can still retrieve its own ticket cleanly!
      const validTicketResA = await clientA.get(stolenTicketUrl);
      assert.equal(validTicketResA.statusCode, 200);
      assert.equal(validTicketResA.headers['content-type'], 'application/zip');
      recordPass();

      // Step 5: Logout Isolation
      // Session A logs out.
      await clientA.logout();
      const checkA = await clientA.get('/api/games');
      assert.equal(checkA.statusCode, 401);

      // Session B remains connected, fully functional, and unaffected
      const checkB = await clientB.get('/api/games');
      assert.equal(checkB.statusCode, 200);
      assert.equal(checkB.json().games.length, 3);
      recordPass();

      console.log('  ✔ PROBE 5 PASSED: Complete session isolation; zero state bleed; plans and tickets account-bound.');
    } finally {
      await app.close();
    }
  }

  console.log('\n================================================================');
  console.log(`ALL ADVERSARIAL PROBES PASSED SUCCESSFULLY (${passedAssertions} assertions verified)`);
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('\n❌ ADVERSARIAL PROBE FAILED:');
  console.error(err);
  process.exit(1);
});
