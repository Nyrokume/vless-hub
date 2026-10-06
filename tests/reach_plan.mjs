import {
  CLOSED_TTL_MS,
  MANUAL_GAP_MS,
  OPEN_TTL_MS,
  REACH_CONCURRENCY,
  REACH_STOP_AT,
  STALE_BATCH,
  gateFromBook,
  hitFresh,
  lockHeld,
  manualDue,
  parseLock,
  planReach,
  shouldProbeMore,
} from '../site/src/lib/reach.ts'

function fail(message) {
  console.error(message)
  process.exit(1)
}

const now = 1_000_000_000_000
const target = (host, port = 443) => ({ host, port })
const hit = (status, at) => ({ status, ms: status === 'open' ? 120 : null, at })
const book = (entries) => ({ at: now, byEndpoint: entries })

if (REACH_CONCURRENCY !== 3) fail(`concurrency ${REACH_CONCURRENCY}`)
if (REACH_STOP_AT !== 8) fail(`stop ${REACH_STOP_AT}`)
if (OPEN_TTL_MS !== 20 * 60 * 1000) fail('open ttl')
if (CLOSED_TTL_MS !== 5 * 60 * 1000) fail('closed ttl')
if (STALE_BATCH !== 4) fail('batch')
if (MANUAL_GAP_MS !== 2 * 60 * 1000) fail('manual gap')

if (hitFresh(undefined, now)) fail('missing hit is fresh')
if (hitFresh(hit('open', 0), now)) fail('missing time is fresh')
if (!hitFresh(hit('open', now - OPEN_TTL_MS + 1), now)) fail('open expired early')
if (hitFresh(hit('open', now - OPEN_TTL_MS), now)) fail('open lived past 20 min')
if (!hitFresh(hit('closed', now - CLOSED_TTL_MS + 1), now)) fail('closed expired early')
if (hitFresh(hit('closed', now - CLOSED_TTL_MS), now)) fail('closed lived past 5 min')
if (!hitFresh(hit('skip', now - OPEN_TTL_MS + 1), now)) fail('skip uses the short ttl')

const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']
let plan = planReach([target('a'), target('b'), target('a')], book({}), now, false)
if (!plan.splash || plan.gate !== 'scan' || plan.pending.length !== 2 || plan.freshOpen !== 0) {
  fail(`empty cache ${JSON.stringify(plan)}`)
}

const five = {}
for (const name of names.slice(0, 5)) five[`${name}:443`] = hit('open', now - 1000)
plan = planReach(names.slice(0, 5).map((name) => target(name)), book(five), now, false)
if (plan.splash || plan.gate !== 'ready' || plan.pending.length !== 0 || plan.freshOpen !== 5) {
  fail(`five fresh ${JSON.stringify(plan)}`)
}

const eight = {}
for (const name of names.slice(0, 8)) eight[`${name}:443`] = hit('open', now - 1000)
eight['i:443'] = hit('closed', now - CLOSED_TTL_MS - 1)
eight['j:443'] = hit('closed', now - CLOSED_TTL_MS - 1)
plan = planReach(names.slice(0, 10).map((name) => target(name)), book(eight), now, false)
if (plan.splash || plan.gate !== 'ready' || plan.freshOpen !== 8) fail(`eight meta ${JSON.stringify(plan)}`)
if (plan.pending.map((item) => item.host).join() !== 'i,j') fail(`eight pending ${plan.pending.map((item) => item.host)}`)

const manyStale = { ...eight }
for (const name of ['i', 'j', 'k', 'l', 'm', 'n']) manyStale[`${name}:443`] = hit('closed', now - CLOSED_TTL_MS - 5)
plan = planReach([...names.slice(0, 8), 'i', 'j', 'k', 'l', 'm', 'n'].map((name) => target(name)), book(manyStale), now, false)
if (plan.pending.map((item) => item.host).join() !== 'i,j,k,l') fail(`stale batch ${plan.pending.map((item) => item.host)}`)

const partial = {}
for (const name of names.slice(0, 2)) partial[`${name}:443`] = hit('open', now - 1000)
plan = planReach([...names.slice(0, 2), 'x', 'y', 'z'].map((name) => target(name)), book(partial), now, false)
if (plan.splash || plan.gate !== 'ready' || plan.freshOpen !== 2) fail(`partial meta ${JSON.stringify(plan)}`)
if (plan.pending.map((item) => item.host).join() !== 'x,y,z') fail(`partial pending ${plan.pending.map((item) => item.host)}`)

const closed = { 'a:443': hit('closed', now - 1000), 'b:443': hit('closed', now - 1000) }
plan = planReach([target('a'), target('b')], book(closed), now, false)
if (plan.splash || plan.gate !== 'short' || plan.pending.length !== 0 || plan.freshAny !== true) {
  fail(`fresh failures ${JSON.stringify(plan)}`)
}

const mixed = {
  'a:443': hit('open', now - 1000),
  'b:443': hit('closed', now - 1000),
  'c:443': hit('open', now - OPEN_TTL_MS - 1),
}
plan = planReach([target('a'), target('b'), target('c'), target('d')], book(mixed), now, true)
if (plan.pending.map((item) => item.host).join() !== 'a,b,c,d') fail(`force order ${plan.pending.map((item) => item.host)}`)

if (gateFromBook(book({}), now) !== 'idle') fail('empty gate')
if (gateFromBook(book(five), now) !== 'ready') fail('open gate')
if (gateFromBook(book(closed), now) !== 'short') fail('closed gate')
if (gateFromBook(book({ 'a:443': hit('open', now - OPEN_TTL_MS - 1) }), now) !== 'idle') fail('expired gate')

if (!manualDue(null, now) || !manualDue(0, now)) fail('manual missing')
if (manualDue(now - MANUAL_GAP_MS + 1, now)) fail('manual too soon')
if (!manualDue(now - MANUAL_GAP_MS, now)) fail('manual due')

if (lockHeld(null, now, 'me')) fail('empty lock')
if (!lockHeld({ owner: 'other', until: now + 1000 }, now, 'me')) fail('foreign lock')
if (lockHeld({ owner: 'me', until: now + 1000 }, now, 'me')) fail('own lock')
if (lockHeld({ owner: 'other', until: now - 1 }, now, 'me')) fail('expired lock')
if (parseLock('nope') !== null) fail('bad lock')
if (parseLock(JSON.stringify({ owner: 'me', until: 5 }))?.owner !== 'me') fail('parsed lock')

if (!shouldProbeMore('find', 'find', 7, 0)) fail('find continues')
if (shouldProbeMore('find', 'find', 8, 0) || shouldProbeMore('find', 'stale', 8, 0)) fail('find stops')
if (!shouldProbeMore('topup', 'stale', 8, 0) || shouldProbeMore('topup', 'find', 0, 0)) fail('topup')
if (!shouldProbeMore('force', 'force', 20, 7) || shouldProbeMore('force', 'force', 20, 8)) fail('force cap')

console.log('reach plan ok')
