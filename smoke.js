// 临时冒烟测试：fork 子进程监听 3199，验证设置/备份接口后自动退出
const { fork } = require('child_process');

const child = fork('server.js', [], {
  env: Object.assign({}, process.env, { PORT: '3199' }),
  stdio: 'ignore'
});
const base = 'http://localhost:3199';

function req(path, opt) {
  return fetch(base + path, opt).then(r => r.json());
}

setTimeout(async () => {
  try {
    const g1 = await req('/api/settings');
    console.log('GET settings -> code:', g1.code, JSON.stringify(g1.data));

    const put = await req('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolName: 'ICBS-TEST', balanceGender: 2, balanceSpecialty: 1.5 })
    });
    console.log('PUT settings -> code:', put.code, 'msg:', put.msg);

    const g2 = await req('/api/settings');
    console.log('GET after PUT -> schoolName:', g2.data && g2.data.schoolName,
      'gender:', g2.data && g2.data.balanceGender,
      'specialty:', g2.data && g2.data.balanceSpecialty);

    const bakRes = await fetch(base + '/api/backup');
    const bakTxt = await bakRes.text();
    console.log('BACKUP -> http:', bakRes.status, 'len:', bakTxt.length,
      'contains ICBS-TEST:', bakTxt.indexOf('ICBS-TEST') >= 0);

    const reset = await req('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolName: '智能分班系统', balanceGender: 1.5, balanceSpecialty: 2 })
    });
    console.log('RESET -> code:', reset.code);
  } catch (e) {
    console.log('ERR', e.message);
    process.exitCode = 1;
  } finally {
    child.kill();
    setTimeout(() => process.exit(), 300);
  }
}, 1200);
