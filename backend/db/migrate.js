import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'aegis.db');

const db = new DatabaseSync(DB_PATH);

try {
    db.exec(`ALTER TABLE portfolio_stats ADD COLUMN simulation_id INTEGER REFERENCES simulations(id)`);
    console.log('Added simulation_id to portfolio_stats');
} catch (e) {
    console.log('portfolio_stats already has simulation_id or error:', e.message);
}

try {
    db.exec(`ALTER TABLE agent_logs ADD COLUMN simulation_id INTEGER REFERENCES simulations(id)`);
    console.log('Added simulation_id to agent_logs');
} catch (e) {
    console.log('agent_logs already has simulation_id or error:', e.message);
}

try {
    db.exec(`ALTER TABLE decision_memory ADD COLUMN simulation_id INTEGER REFERENCES simulations(id)`);
    console.log('Added simulation_id to decision_memory');
} catch (e) {
    console.log('decision_memory already has simulation_id or error:', e.message);
}

console.log('Migration complete.');
