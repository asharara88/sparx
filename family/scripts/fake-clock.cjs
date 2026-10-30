// Moves this Node process's clock to FAKE_NOW (keeps ticking), for the scenario's server.
const off = Date.parse(process.env.FAKE_NOW) - Date.now();
const R = Date;
class D extends R {
  constructor(...a) { if (a.length === 0) super(R.now() + off); else super(...a); }
}
for (const k of ["parse", "UTC"]) D[k] = R[k];
D.now = () => R.now() + off;
globalThis.Date = D;
