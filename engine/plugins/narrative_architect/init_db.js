const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

async function init() {
    const dbPath = path.join(__dirname, 'episodes.db');

    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    await db.exec(`
    CREATE TABLE IF NOT EXISTS episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT,
        filename TEXT,
        status TEXT,
        sub_track TEXT,
        condensed_path TEXT,
        summary TEXT,
        tags_json TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    `);

    console.log('Database initialized successfully at ' + dbPath);
    await db.close();
}

init().catch(err => {
    console.error(err);
    process.exit(1);
});
