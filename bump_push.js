const fs = require('fs');
const { execSync } = require('child_process');

const VERSION_FILE = 'build-version.json';

function run(cmd) {
    execSync(cmd, { stdio: 'inherit' });
}

try {
    const status = execSync('git status --porcelain').toString().trim();
    if (status) {
        console.error('❌ Working tree is not clean.');
        process.exit(1);
    }

    const data = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
    data.build += 1;

    fs.writeFileSync(
        VERSION_FILE,
        JSON.stringify(data, null, 2) + '\n'
    );

    run(`git add ${VERSION_FILE}`);
    run(`git commit -m "chore: bump backend build to ${data.build}"`);
    run('git push');

    console.log(`✅ Backend build ${data.build} pushed`);
} catch {
    process.exit(1);
}
