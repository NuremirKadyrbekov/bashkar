const { Storage } = require('../../../../dist/apps/local-server/src/storage.js');
try {
  const storage = new Storage(process.argv[2]);
  const state = storage.open();
  process.stdout.write(JSON.stringify(state) + '\n');
  process.stdin.resume();
  process.stdin.on('end', () => { storage.close(); process.exit(0); });
} catch (error) {
  process.stderr.write(String(error.message) + '\n'); process.exitCode = 1;
}
