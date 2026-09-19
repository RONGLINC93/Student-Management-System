// 照片上传 / 摄像头拍照（教师、学生、后勤职工共用）
// 照片随档案保存：优先 data:image 的 base64（与校徽同口径），也兼容外部图片链接。
// 前端先居中裁剪为正方形并压缩，避免把几 MB 的原图直接写进数据文件。
// 用法：const f = PhotoField.create({ preview, pick, cam, clear, input, onChange }); f.get() / f.set(v) / f.clear()
(function () {
  'use strict';

  const MAX_CHARS = 300000;   // 压缩后上限（约 300KB），服务端另有兜底校验
  // 合法图片来源：data:image 数据（上传 / 拍照）或图片链接；其它值一律按「无照片」处理
  function isSrc(v) {
    if (typeof v !== 'string') return false;
    const s = v.trim();
    return /^data:image\//.test(s) || /^https?:\/\//i.test(s) || /^\//.test(s);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
  function toast(msg, type) {
    if (typeof window.toast === 'function') window.toast(msg, type);
  }
  const el = (x) => (typeof x === 'string' ? document.querySelector(x) : x);

  // 居中裁剪为正方形并压缩为 JPEG：先按质量降档，仍超限再缩小尺寸。
  // 源可以是 <img>（naturalWidth）或 <video> 当前帧（videoWidth）；输出边长不超过源短边（不放大）。
  function squareImage(img, size) {
    try {
      const sw = img.naturalWidth || img.videoWidth || img.width;
      const sh = img.naturalHeight || img.videoHeight || img.height;
      if (!sw || !sh) return '';
      const side = Math.min(sw, sh);
      const outSize = Math.max(160, Math.min(size, side));   // 下限 160，且不放大小图
      const sx = (sw - side) / 2;
      const sy = (sh - side) / 2;
      const cv = document.createElement('canvas');
      cv.width = outSize;
      cv.height = outSize;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, outSize, outSize);
      ctx.drawImage(img, sx, sy, side, side, 0, 0, outSize, outSize);
      let q = 0.85;
      let out = cv.toDataURL('image/jpeg', q);
      while (out.length > MAX_CHARS && q > 0.46) {
        q -= 0.12;
        out = cv.toDataURL('image/jpeg', q);
      }
      if (out.length > MAX_CHARS) {
        const small = Math.max(160, Math.min(240, outSize));
        const cv2 = document.createElement('canvas');
        cv2.width = small;
        cv2.height = small;
        const c2 = cv2.getContext('2d');
        c2.fillStyle = '#fff';
        c2.fillRect(0, 0, small, small);
        c2.drawImage(cv, 0, 0, outSize, outSize, 0, 0, small, small);
        out = cv2.toDataURL('image/jpeg', 0.7);
      }
      return out;
    } catch (e) {
      return '';
    }
  }

  // 选择本地图片 → 读取 → 裁剪压缩 → apply(dataUrl)
  function readPhotoFile(file, apply) {
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { toast('请选择图片文件', 'error'); return; }
    if (file.size > 8 * 1024 * 1024) { toast('图片超过 8MB，请压缩后再上传', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const out = squareImage(img, 320);
        if (!out) { toast('图片处理失败，请换一张', 'error'); return; }
        apply(out);
        toast('照片已就绪，点击保存后生效', 'success');
      };
      img.onerror = () => toast('图片解析失败，请换一张', 'error');
      img.src = String(reader.result || '');
    };
    reader.onerror = () => toast('图片读取失败，请重试', 'error');
    reader.readAsDataURL(file);
  }

  /* ===== 摄像头：全局唯一取景弹窗（DOM 懒创建，拍照结果交给调用方）===== */
  let camStream = null;
  let camTarget = null;   // 当前拍照结果回填给哪个 PhotoField 实例
  const camSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  let camEls = null;

  function ensureCam() {
    if (camEls) return camEls;
    const wrap = document.createElement('div');
    wrap.className = 'modal-mask';
    wrap.id = 'pfCamMask';
    wrap.innerHTML =
      '<div class="modal">' +
        '<div class="modal-header"><h3>摄像头拍照</h3>' +
          '<button class="modal-close" id="pfCamClose" aria-label="关闭"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div class="cam-stage">' +
            '<video id="pfCamVideo" playsinline autoplay muted></video>' +
            '<div class="cam-empty" id="pfCamEmpty" hidden>正在打开摄像头…</div>' +
          '</div>' +
          '<select id="pfCamSelect" class="grade-filter cam-select" hidden aria-label="选择摄像头"></select>' +
          '<p class="photo-tip" id="pfCamTip">请正对摄像头，拍摄后自动居中裁剪为正方形头像（需浏览器授予摄像头权限）。</p>' +
        '</div>' +
        '<div class="modal-footer">' +
          '<button type="button" class="btn btn-default" id="pfCamCancel">取消</button>' +
          '<button type="button" class="btn btn-primary" id="pfCamShot">拍摄</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    camEls = {
      mask: wrap,
      video: wrap.querySelector('#pfCamVideo'),
      empty: wrap.querySelector('#pfCamEmpty'),
      tip: wrap.querySelector('#pfCamTip'),
      select: wrap.querySelector('#pfCamSelect')
    };
    wrap.querySelector('#pfCamClose').onclick = closeCam;
    wrap.querySelector('#pfCamCancel').onclick = closeCam;
    wrap.querySelector('#pfCamShot').onclick = camShot;
    camEls.select.addEventListener('change', () => startCam(camEls.select.value));
    return camEls;
  }

  // 停止采集并释放摄像头（关闭弹窗、切换设备、离开页面时都要调用）
  function stopCam() {
    if (camStream) {
      camStream.getTracks().forEach(t => t.stop());
      camStream = null;
    }
    if (camEls && camEls.video) camEls.video.srcObject = null;
  }
  function closeCam() {
    stopCam();
    camTarget = null;
    if (camEls) {
      camEls.mask.classList.remove('show');
      camEls.empty.hidden = true;
    }
  }
  function camFail(msg, tip) {
    if (!camEls) return;
    camEls.empty.hidden = false;
    camEls.empty.textContent = msg;
    camEls.tip.textContent = tip || msg;
  }
  async function startCam(deviceId) {
    if (!camEls) return;
    if (!camSupported()) {
      camFail('当前环境不支持摄像头', '浏览器不支持摄像头，或需通过 https / localhost 访问本系统后才能拍照。');
      return;
    }
    stopCam();
    const cons = { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false };
    if (deviceId) cons.video.deviceId = { exact: deviceId };
    try {
      camStream = await navigator.mediaDevices.getUserMedia(cons);
      camEls.video.srcObject = camStream;
      await camEls.video.play().catch(() => {});   // 自动播放策略可能拒绝，静默忽略
      camEls.empty.hidden = true;
      camEls.tip.textContent = '请正对摄像头，拍摄后自动居中裁剪为正方形头像。';
      fillCamList();   // 授权后才能拿到设备名，此时再填「摄像头」下拉
    } catch (e) {
      const name = (e && e.name) || '';
      const msg = name === 'NotAllowedError' ? '摄像头权限被拒绝，请在浏览器地址栏允许后重试'
        : (name === 'NotFoundError' || name === 'OverconstrainedError') ? '未找到可用的摄像头'
        : name === 'NotReadableError' ? '摄像头被其它程序占用，请关闭后重试'
        : '摄像头打开失败：' + ((e && e.message) || '未知错误');
      camFail(msg);
    }
  }
  // 多摄像头时可切换（授权后 enumerateDevices 才有可读名称）
  async function fillCamList() {
    if (!camEls || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const vids = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      camEls.select.innerHTML = vids.map((d, i) => '<option value="' + esc(d.deviceId) + '">'
        + esc(d.label || ('摄像头 ' + (i + 1))) + '</option>').join('');
      camEls.select.hidden = vids.length < 2;   // 只有一个摄像头时不显示切换
      const track = camStream && camStream.getVideoTracks()[0];
      const id = track && track.getSettings ? (track.getSettings() || {}).deviceId : '';
      if (id) camEls.select.value = id;
    } catch (e) {
      camEls.select.hidden = true;
    }
  }
  function openCam(target) {
    if (!camSupported()) { toast('当前环境不支持摄像头（需 https 或 localhost 访问）', 'error'); return; }
    camTarget = target;
    const c = ensureCam();
    c.mask.classList.add('show');
    startCam('');
  }
  function camShot() {
    if (!camEls) return;
    const v = camEls.video;
    if (!v || !v.videoWidth) { toast('摄像头尚未就绪，请稍候再拍', 'error'); return; }
    const out = squareImage(v, 480);
    if (!out) { toast('拍照失败，请重试', 'error'); return; }
    const target = camTarget;
    closeCam();
    if (target) target.set(out);
    toast('照片已就绪，点击保存后生效', 'success');
  }
  window.addEventListener('pagehide', stopCam);   // 离开页面时释放摄像头

  /* ===== 对外接口 ===== */
  window.PhotoField = {
    isSrc: isSrc,
    // opts: preview（预览容器）/ pick（选择照片按钮）/ cam（摄像头拍照按钮）/ clear（移除按钮）
    //       input（可选 file input，缺省自动创建）/ emptyText（无照片时的占位文字）/ onChange（值变化回调）
    create(opts) {
      const o = opts || {};
      const preview = el(o.preview);
      const clearBtn = el(o.clear);
      const input = el(o.input) || (function () {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.hidden = true;
        document.body.appendChild(inp);
        return inp;
      })();
      let value = '';
      function render() {
        if (preview) {
          preview.innerHTML = value
            ? '<img src="' + esc(value) + '" alt="照片预览" />'
            : '<span>' + esc(o.emptyText || '暂无照片') + '</span>';
        }
        if (clearBtn) clearBtn.disabled = !value;
      }
      function set(v) {
        value = isSrc(v) ? String(v).trim() : '';
        render();
        if (typeof o.onChange === 'function') o.onChange(value);
      }
      const api = { get: () => value, set: set, clear: () => set('') };
      input.addEventListener('change', () => {
        readPhotoFile(input.files && input.files[0], set);
        input.value = '';   // 允许重复选择同一张
      });
      const pickBtn = el(o.pick);
      if (pickBtn) pickBtn.onclick = () => input.click();
      const camBtn = el(o.cam);
      if (camBtn) { camBtn.hidden = !camSupported(); camBtn.onclick = () => openCam(api); }
      if (clearBtn) clearBtn.onclick = () => set('');
      render();
      return api;
    }
  };
})();
