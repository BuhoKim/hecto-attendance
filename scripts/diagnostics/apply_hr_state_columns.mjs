import { settings } from '../migration/connection.mjs';

const { client } = settings('TARGET');
const c = client();
await c.connect();
const ddl = [
  'ALTER TABLE public.sa_employees ADD COLUMN IF NOT EXISTS hr_state_code VARCHAR(10)',
  'ALTER TABLE public.sa_employees ADD COLUMN IF NOT EXISTS hr_state_date DATE',
  'CREATE INDEX IF NOT EXISTS sa_employees_hr_state_code_idx ON public.sa_employees (hr_state_code)',
];
for (const s of ddl) await c.query(s);
const r = await c.query(
  "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='sa_employees' AND column_name LIKE 'hr_state%' ORDER BY column_name"
);
console.log(JSON.stringify(r.rows));
await c.end();
