const { spawn } = require('child_process');
const path = require('path');
const constants = require('@constants');

const runDockerCommand = (command, params, env=process.env) => {
  return new Promise((resolve, reject) => {
    const cmd = spawn(command, params, { cwd: path.join(__dirname, 'keep-alive-script'), env });
    const output = [];
    const log = (data) => output.push(data.toString().replace(/\n/g, ''));
    cmd.on('error', reject);
    cmd.stdout.on('data', log);
    cmd.stderr.on('data', log);
    cmd.on('close', () => resolve(output));
  });
};

const runScript = async () => {
  const env = { ...process.env };
  env.USER = constants.USERNAME;
  env.PASSWORD = constants.PASSWORD;
  return await runDockerCommand('docker-compose', ['up', '--build', '--force-recreate'], env);
};
const getLogs = async () => {
  const containerName = (await runDockerCommand('docker-compose', ['ps', '-q', '-a']))[0];
  const logs = await runDockerCommand('docker', ['logs', containerName]);
  return logs?.filter(log => log);
};

describe('logging in through API directly', () => {
  after(async () => {
    const containerName = (await runDockerCommand('docker-compose', ['ps', '-q', '-a']))[0];
    await runDockerCommand('docker', ['rm', containerName]);
  });

  it('should allow logins', async () => {
    await runScript();
    const logs = await getLogs();

    console.log(logs);

    expect(logs).to.include('HTTP/1.1 400 Bad Request');
    expect(logs).to.include('{"error":"Not logged in"}');
    expect(logs).to.include('Connection: keep-alive');
  });
});
