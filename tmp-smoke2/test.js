const http = require('http');
const BASE = { host: '127.0.0.1', port: 3101 };
function req(method, p, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opt = { method, host: BASE.host, port: BASE.port, path: p, headers: {} };
    if (data) opt.headers['Content-Type'] = 'application/json';
    if (cookie) opt.headers['Cookie'] = cookie;
    const r = http.request(opt, res => {
      let b = ''; res.on('data', d => b += d);
      res.on('end', () => { let j; try { j = JSON.parse(b); } catch (e) { j = b; }
        resolve({ status: res.statusCode, cookie: res.headers['set-cookie'], json: j }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + ' ' + m);
(async () => {
  try {
    let a = await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
    ok(a.status === 200 && a.json.code === 0, 'admin 登录 ' + a.status);
    const ac = a.cookie && a.cookie[0];
    let dep = await req('GET', '/api/departments', null, ac);
    ok(dep.json.code === 0 && dep.json.data.length >= 12, '默认部门数 ' + (dep.json.data && dep.json.data.length));
    const tree = dep.json.data.map(d => ({ id: d.id, name: d.name, parentId: d.parentId || '', desc: d.desc || '' }));
    tree.forEach(d => { if (d.id === 'dep_aq') d.parentId = 'dep_zwc'; if (d.id === 'dep_st') d.parentId = 'dep_zwc'; });
    let put = await req('PUT', '/api/departments', tree, ac);
    const aq = put.json.data && put.json.data.find(x => x.id === 'dep_aq');
    ok(put.status === 200 && aq && aq.parentId === 'dep_zwc', '层级保存 安保处→总务处 ' + (aq && aq.parentId));
    const ring = tree.map(d => Object.assign({}, d));
    ring.forEach(d => { if (d.id === 'dep_aq') d.parentId = 'dep_st'; if (d.id === 'dep_st') d.parentId = 'dep_aq'; });
    let ringRes = await req('PUT', '/api/departments', ring, ac);
    ok(ringRes.status === 400, '环校验拒绝 ' + ringRes.status);
    await req('PUT', '/api/departments', tree, ac);
    let set = await req('GET', '/api/settings', null, ac);
    const S = set.json.data;
    S.deptPermissions = { v: 1, depts: [{ id: 'dep_perm_总务处', name: '总务处', modules: ['students'] }] };
    let setPut = await req('PUT', '/api/settings', S, ac);
    ok(setPut.status === 200, '部门权限保存 ' + setPut.status);
    let add = await req('POST', '/api/teachers', { teacherNo: 'T9991', name: '级联验证', gender: '男', department: '安保处', position: '', status: '在职' }, ac);
    ok(add.status === 200, '创建子部门教师 ' + add.status);
    let tl = await req('GET', '/api/teachers', null, ac);
    const t = tl.json.data.find(x => x.teacherNo === 'T9991');
    const mods = (t && t.perm && t.perm.modules) || [];
    ok(mods.indexOf('students') !== -1, '子部门继承父部门权限 students=' + JSON.stringify(mods) + ' matched=' + (t && t.perm && t.perm.matched));
    let hr = await req('GET', '/hr.html'); ok(hr.status === 200, 'hr.html ' + hr.status);
    let st = await req('GET', '/settings.html'); ok(st.status === 200, 'settings.html ' + st.status);
    console.log('DONE');
  } catch (e) { console.log('ERR', e.message); }
})();
