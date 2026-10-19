// Run manually with:  npm run migrate     (the server also does this on every start)
const { migrate, pool } = require('../src/db');

migrate()
  .then(() => console.log('Database tables are ready.'))
  .catch((e) => {
    console.error('Migration failed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
