// Etiquetas de preps (50 x 30 mm): imprimir, histórico e validades.
// Usa as funções do banco emitir_etiqueta / reimprimir_etiqueta (a validade é calculada no servidor).
// Depende de globais do index.html: db, currentRole, currentUser, toast.
(function(){
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MODOS = { horas:'Horas corridas', dias_ate_2359:'Dias (vence às 23h59)', consumo_dia:'Consumo no dia (até 23h59)' };
const SITUACAO = {
  gerada:'Arquivo gerado; impressão não confirmada',
  enviada_ao_aparelho:'Enviada à impressora; papel não conferido',
  conferida:'Impressão conferida no papel',
  falha:'Falha relatada'
};
const E = { preps:[], regras:{}, cubas:[], sel:null, reqId:null, copias:1, busy:false, lotes:[], dlg:null, carregado:false };

// ---------- datas (Brasil sem horário de verão desde 2019: America/Sao_Paulo = UTC-3 fixo) ----------
const SP_OFF = 3 * 3600e3;
const p2 = n => String(n).padStart(2, '0');
function spParts(d){ const s = new Date(d.getTime() - SP_OFF); return { y:s.getUTCFullYear(), mo:s.getUTCMonth()+1, d:s.getUTCDate(), h:s.getUTCHours(), mi:s.getUTCMinutes() }; }
function fmtCurta(d){ const p = spParts(new Date(d)); return `${p2(p.d)}/${p2(p.mo)}/${String(p.y).slice(2)} ${p2(p.h)}:${p2(p.mi)}`; }
function toInputSP(d){ const p = spParts(d); return `${p.y}-${p2(p.mo)}-${p2(p.d)}T${p2(p.h)}:${p2(p.mi)}`; }
function fromInputSP(v){ return new Date(v + ':00-03:00'); }
// Mesma regra de fn_etiqueta_validade no banco (a emissão real sempre usa o valor do servidor).
function calcValidade(modo, dur, fab){
  if(modo === 'horas') return new Date(fab.getTime() + dur * 3600e3);
  if(modo === 'dias_ate_2359' || modo === 'consumo_dia'){
    const p = spParts(fab);
    return new Date(Date.UTC(p.y, p.mo-1, p.d + (modo === 'consumo_dia' ? 0 : dur), 23 + 3, 59));
  }
  return null;
}
function uuid(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(x => p2(x.toString(16))).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
const fmtKg = g => (Number(g) / 1000).toFixed(3).replace('.', ',') + ' kg';
function parseKg(v){ const t = String(v ?? '').trim(); if(!/^\d{1,6}([.,]\d{1,3})?$/.test(t)) return NaN; return Math.round(parseFloat(t.replace(',', '.')) * 1000); }
// Acima do limite o sistema pergunta por extenso (vírgula esquecida: 5800 em vez de 5,800). Máximo = o do servidor.
const PESO_LIMITE_G = 30000, PESO_MAX_G = 200000, TARA_LIMITE_G = 5000, TARA_MAX_G = 50000;
const kgCampo = g => (g / 1000).toFixed(3).replace('.', ',');
// Pergunta sobre o peso suspeito e aplica a resposta no campo. true = pode seguir.
async function conferirPeso(){
  const ps = pesoAtual();
  if(!ps.suspeito || E.conferindo) return !ps.suspeito;
  E.conferindo = true;
  const v = await ValorExtenso.conferir(ps.bruto, { campo:'Peso na balança', unidade:'kg', limite:PESO_LIMITE_G, maximo:PESO_MAX_G });
  E.conferindo = false;
  if(v == null){ $('etqPeso').focus(); $('etqPeso').select(); return false; }
  if(v !== ps.bruto) $('etqPeso').value = kgCampo(v);
  E.pesoOk = v; E.reqId = uuid(); preview();
  return true;
}
// Lê peso + cuba do formulário. A conta oficial é refeita no servidor.
function pesoAtual(){
  const bruto = parseKg($('etqPeso').value), sel = $('etqCuba').value;
  if(!$('etqPeso').value.trim()) return { erro:'Informe o peso que a balança mostrou.' };
  if(isNaN(bruto) || bruto <= 0) return { erro:'Peso inválido. Digite em kg, por exemplo 5,800.' };
  if(bruto > PESO_LIMITE_G && E.pesoOk !== bruto) return { erro:`Peso muito alto (${ValorExtenso.fmt(bruto, 'kg')}). Confira se faltou a vírgula.`, suspeito:true, bruto };
  if(!sel) return { erro:'Escolha a cuba usada (ou "Sem cuba").' };
  let tara = 0, cubaId = null;
  if(sel !== 'sem'){ const c = E.cubas.find(x => x.id === sel); if(!c) return { erro:'Cuba não encontrada. Recarregue a página.' }; tara = Math.round(Number(c.tara_g)); cubaId = c.id; }
  if(bruto - tara <= 0) return { erro:`O peso na balança (${fmtKg(bruto)}) precisa ser maior que a tara da cuba (${fmtKg(tara)}).` };
  return { bruto, tara, liq:bruto - tara, cubaId };
}
function descRegra(r){
  if(!r || !r.modo) return 'sem validade';
  if(!r.ativa) return 'desativada';
  if(r.modo === 'horas') return `${r.duracao} h corridas`;
  if(r.modo === 'dias_ate_2359') return `${r.duracao} dia(s), até 23h59`;
  return 'no dia, até 23h59';
}
const pronto = r => !!(r && r.ativa && r.modo);
const msgErro = e => { const m = (e && e.message) || String(e); return m.includes('sem_validade') ? 'O admin ainda não definiu a validade deste prep.' : m.replace(/^(peso_invalido|cuba_invalida): /, ''); };

// ---------- desenho da etiqueta (SVG 400x240 = 50x30 mm a 8 pontos/mm) ----------
const mctx = document.createElement('canvas').getContext('2d');
const FONT = 'Arial, Helvetica, sans-serif';
function tw(text, size, bold){ mctx.font = `${bold ? '700' : '400'} ${size}px ${FONT}`; return mctx.measureText(text).width; }
function fit1(text, maxW, maxS, minS, bold){ for(let s = maxS; s >= minS; s--){ if(tw(text, s, bold) <= maxW) return s; } return null; }
function fitName(name, maxW){
  for(let s = 44; s >= 22; s -= 2){ if(tw(name, s, true) <= maxW) return { lines:[name], size:s }; }
  const words = name.split(/\s+/);
  for(let s = 34; s >= 20; s -= 2){
    let best = null;
    for(let i = 1; i < words.length; i++){
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      const m = Math.max(tw(a, s, true), tw(b, s, true));
      if(m <= maxW && (!best || m < best.m)) best = { lines:[a, b], m };
    }
    if(best) return { lines:best.lines, size:s };
  }
  return null;
}
function buildLabel(o){
  const W = 400, H = 240, M = 16, CW = W - 2*M;
  const nm = fitName(o.nome, CW);
  if(!nm) return { erro:'O nome do prep não cabe na etiqueta. Encurte o nome.' };
  const fabT = `FAB ${fmtCurta(o.fab)}`, valT = `VAL ${fmtCurta(o.val)}`, loteT = `Lote ${o.lote}`;
  const pesoT = o.pesoG != null ? `Líq. ${fmtKg(o.pesoG)}` : '', pesoW = pesoT ? tw(pesoT, 26, true) + 14 : 0;
  const sF = fit1(fabT, CW, 28, 18, true), sV = fit1(valT, CW - 24, 36, 20, true), sL = fit1(loteT, CW - pesoW, 24, 14, false);
  if(!sF || !sV || !sL) return { erro:'O lote é longo demais para caber na etiqueta.' };
  const lh = nm.size * 1.08, y0 = 12 + (80 - lh * nm.lines.length) / 2;
  const nameSvg = nm.lines.map((t, i) => `<text x="${W/2}" y="${(y0 + lh * (i + .82)).toFixed(1)}" font-size="${nm.size}" font-weight="700" text-anchor="middle">${esc(t)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}" fill="#000">` +
    `<rect width="${W}" height="${H}" fill="#fff"/>${nameSvg}` +
    `<line x1="${M}" y1="98" x2="${W-M}" y2="98" stroke="#000" stroke-width="2"/>` +
    `<text x="${M}" y="128" font-size="${sF}" font-weight="700">${esc(fabT)}</text>` +
    `<rect x="${M}" y="138" width="${CW}" height="56" rx="4" fill="none" stroke="#000" stroke-width="3"/>` +
    `<text x="${W/2}" y="${(166 + sV * .35).toFixed(1)}" font-size="${sV}" font-weight="700" text-anchor="middle">${esc(valT)}</text>` +
    `<text x="${M}" y="224" font-size="${sL}">${esc(loteT)}</text>` +
    (pesoT ? `<text x="${W-M}" y="224" font-size="26" font-weight="700" text-anchor="end">${esc(pesoT)}</text>` : '') + `</svg>`;
  return { svg };
}
function svgToPng(svg, scale = 2){
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = 400 * scale; c.height = 240 * scale;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => b ? res(b) : rej(new Error('Falha ao gerar a imagem')), 'image/png');
    };
    img.onerror = () => rej(new Error('Falha ao gerar a imagem'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}
// B1 (203 dpi): cabeça de impressão de 384 px. A etiqueta 400x240 é reduzida uniformemente (0,96) e centralizada.
const NIIM_MODEL = { name_prefixes:['B1'], task:'b1', density:3, label_type:1, speed:1 };
const NIIM_SIZE = { w_px:384, h_px:240, offset_y_px:4, dpi:203 };
function svgToB1Blob(svg){
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = 384; c.height = 240;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 384, 240);
      const k = 384 / 400, h = 240 * k;
      x.drawImage(img, 0, (240 - h) / 2, 384, h);
      c.toBlob(b => b ? res(b) : rej(new Error('Falha ao gerar a imagem')), 'image/png');
    };
    img.onerror = () => rej(new Error('Falha ao gerar a imagem'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}
async function baixarPng(svg, nome){
  try{
    const blob = await svgToPng(svg);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome.replace(/[^a-z0-9._-]+/gi, '_') + '.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }catch(e){ toast(msgErro(e), false); }
}

// ---------- carga ----------
async function carregar(){
  const [p, r, c] = await Promise.all([
    db.from('preps').select('id,nome').order('nome'),
    db.from('etiqueta_regras').select('prep_id,modo,duracao,ativa'),
    db.from('cubas').select('id,nome,tara_g,ativa').order('nome')
  ]);
  if(p.error || r.error || c.error){ toast('Erro ao carregar etiquetas: ' + (p.error || r.error || c.error).message, false); return; }
  E.cubas = c.data || [];
  renderCubaSelect();
  if(currentRole === 'admin') renderCubas();
  E.preps = p.data || [];
  E.regras = {}; (r.data || []).forEach(x => E.regras[x.prep_id] = x);
  E.carregado = true;
  renderLista();
  if(!E.sel) preview();
  if(currentRole === 'admin') renderValidades();
  if(E.sel){ const s = E.preps.find(x => x.id === E.sel.id); if(s) selecionar(s, true); else limparSel(); }
  carregarHistorico();
}

// ---------- imprimir ----------
function renderLista(){
  const term = ($('etqBusca').value || '').toLowerCase();
  const box = $('etqPreps');
  const lista = E.preps.filter(p => p.nome.toLowerCase().includes(term));
  if(!E.preps.length){ box.innerHTML = '<p class="muted">Nenhum prep cadastrado ainda.' + (currentRole === 'admin' ? ' Cadastre na aba PCP.' : ' Peça ao admin para cadastrar.') + '</p>'; return; }
  if(!lista.length){ box.innerHTML = '<p class="muted">Nenhum prep encontrado.</p>'; return; }
  box.innerHTML = lista.map(p => {
    const r = E.regras[p.id];
    return `<button type="button" class="etq-prep${pronto(r) ? '' : ' sem'}${E.sel && E.sel.id === p.id ? ' sel' : ''}" data-id="${esc(p.id)}"><strong>${esc(p.nome)}</strong><span class="muted">${esc(descRegra(r))}</span></button>`;
  }).join('');
}
function renderCubaSelect(){
  const s = $('etqCuba'), atual = s.value;
  s.innerHTML = '<option value="">— escolha a cuba —</option>' +
    E.cubas.filter(c => c.ativa).map(c => `<option value="${esc(c.id)}">${esc(c.nome)} (tara ${fmtKg(c.tara_g)})</option>`).join('') +
    '<option value="sem">Sem cuba (o peso já é líquido)</option>';
  if([...s.options].some(o => o.value === atual)) s.value = atual;
}
function dicaEscolha(){ $('etqEscolhaDica').textContent = E.sel ? 'Para trocar, toque em outro prep:' : 'Toque no prep para montar a etiqueta acima.'; }
function limparSel(){ E.sel = null; $('etqForm').classList.add('hidden'); dicaEscolha(); renderLista(); preview(); }
function selecionar(p, manter){
  E.sel = p;
  if(!manter){ E.reqId = uuid(); E.copias = 1; $('etqFab').value = toInputSP(new Date()); $('etqLote').value = ''; $('etqCopias').textContent = '1'; $('etqPeso').value = ''; $('etqCuba').value = ''; }
  $('etqForm').classList.remove('hidden');
  const r = E.regras[p.id], ok = pronto(r);
  $('etqSemValidade').classList.toggle('hidden', ok);
  $('etqSemValidade').textContent = r && !r.ativa && r.modo ? 'A etiqueta deste prep está desativada pelo admin.' : 'O admin ainda não definiu a validade deste prep. Peça para ele definir na aba Etiquetas › Validades.';
  $('etqEmitirBtn').disabled = !ok || E.busy;
  $('etqErro').textContent = '';
  renderLista();
  preview();
  dicaEscolha();
  // A lista de preps fica abaixo dos campos: ao escolher, leva a etiqueta montada para a vista.
  if(!manter){ // desconta o cabeçalho e as abas fixos (mais altos no celular)
    const fixo = document.querySelector('.tabs').getBoundingClientRect().bottom;
    window.scrollBy({ top:$('etqPreviewWrap').getBoundingClientRect().top - fixo - 8, behavior:'smooth' });
  }
}
function preview(){
  const box = $('etqPreview');
  if(!E.sel){ box.innerHTML = '<p class="etq-vazia">Toque num prep abaixo para ver a etiqueta aqui.</p>'; return; }
  const r = E.regras[E.sel.id], fab = fromInputSP($('etqFab').value);
  if(!pronto(r)){ box.innerHTML = `<p class="etq-vazia"><strong>${esc(E.sel.nome)}</strong><br>Sem etiqueta: validade não definida.</p>`; return; }
  if(isNaN(fab)){ box.innerHTML = '<p class="muted" style="padding:10px;">Informe a data e hora de fabricação.</p>'; return; }
  const ps = pesoAtual(), conta = $('etqPesoConta');
  conta.textContent = ps.erro ? ($('etqPeso').value.trim() || $('etqCuba').value ? ps.erro : '') : `${fmtKg(ps.bruto)} − ${fmtKg(ps.tara)} (cuba) = ${fmtKg(ps.liq)} líquido`;
  conta.style.color = ps.erro ? 'var(--bad)' : 'var(--ok)';
  const out = buildLabel({ nome:E.sel.nome, fab, val:calcValidade(r.modo, r.duracao, fab), lote:$('etqLote').value.trim() || 'automático', pesoG:ps.erro ? null : ps.liq });
  box.innerHTML = out.erro ? `<p class="auth-error" style="padding:10px;">${esc(out.erro)}</p>` : out.svg;
}
function mudouCampo(){ E.reqId = uuid(); $('etqErro').textContent = ''; preview(); }

async function emitir(){
  if(E.busy || !E.sel) return;
  const r = E.regras[E.sel.id], err = $('etqErro');
  err.textContent = '';
  if(!pronto(r)){ err.textContent = 'Validade não definida para este prep.'; return; }
  const fab = fromInputSP($('etqFab').value);
  if(isNaN(fab)){ err.textContent = 'Informe a data e hora de fabricação.'; return; }
  if(!(await conferirPeso())) return;
  const ps = pesoAtual();
  if(ps.erro){ err.textContent = ps.erro; return; }
  const previa = buildLabel({ nome:E.sel.nome, fab, val:calcValidade(r.modo, r.duracao, fab), lote:$('etqLote').value.trim() || 'automático', pesoG:ps.liq });
  if(previa.erro){ err.textContent = previa.erro; return; }
  E.busy = true; $('etqEmitirBtn').disabled = true; $('etqEmitirBtn').textContent = 'Emitindo…';
  const { data, error } = await db.rpc('emitir_etiqueta_com_peso', {
    p_request_id:E.reqId, p_prep_id:E.sel.id, p_fabricado_em:fab.toISOString(),
    p_peso_bruto_g:ps.bruto, p_cuba_id:ps.cubaId,
    p_lote:$('etqLote').value.trim() || null, p_copias:E.copias
  });
  E.busy = false; $('etqEmitirBtn').textContent = '🏷️ Emitir etiqueta'; $('etqEmitirBtn').disabled = !pronto(E.regras[E.sel.id]);
  if(error){ err.textContent = msgErro(error); return; }
  const l = data.lote;
  E.reqId = uuid();
  toast(data.repetido ? 'Etiqueta já emitida (sem duplicar).' : 'Etiqueta emitida: lote ' + l.lote);
  abrirDialog(l, l.copias, data.impressao_id);
  $('etqLote').value = ''; $('etqPeso').value = ''; preview();
  carregarHistorico();
}

// ---------- diálogo com a etiqueta final (sempre desenhada a partir do que o servidor gravou) ----------
function abrirDialog(l, copias, impId){
  const out = buildLabel({ nome:l.prep_nome, fab:new Date(l.fabricado_em), val:new Date(l.validade_em), lote:l.lote, pesoG:l.peso_liquido_g });
  if(out.erro){ toast(out.erro, false); return; }
  E.dlg = { svg:out.svg, l, copias, impId:impId || null, used:false, busy:false };
  $('etqDialogLabel').innerHTML = out.svg;
  $('etqDialogInfo').textContent = `${copias} cópia(s) registrada(s). Gerar o arquivo ou enviar à impressora não confirma que saiu no papel.`;
  $('etqConfirm').classList.add('hidden');
  const b = $('etqPrintBtn');
  b.disabled = false; b.textContent = '🖨️ Imprimir na Niimbot B1';
  setPrintStatus(impId ? '' : 'Ao imprimir, será registrada uma nova impressão deste lote.');
  const d = $('etqDialog');
  if(d.showModal) d.showModal(); else d.setAttribute('open', '');
}
function setPrintStatus(t, erro){ const e = $('etqPrintStatus'); e.textContent = t; e.style.color = erro ? 'var(--bad)' : ''; }
async function registrar(impId, situacao, obs){
  const { error } = await db.rpc('registrar_resultado_impressao', { p_impressao_id:impId, p_situacao:situacao, p_transporte:'bluetooth', p_observacao:obs || null });
  if(error) toast('Não consegui registrar o resultado: ' + error.message, false);
  return !error;
}
// Impressão direta pelo navegador (Web Bluetooth). Nunca reenvia sozinho; cada tentativa é um registro.
async function imprimirNiimbot(){
  const d = E.dlg;
  if(!d || d.busy) return;
  if(!window.Niimbot || !Niimbot.isSupported()){
    setPrintStatus('Este navegador não tem Bluetooth. No Android use o Chrome; no iPhone, o app Bluefy. Em HTTPS.', true); return;
  }
  d.busy = true; $('etqPrintBtn').disabled = true; $('etqConfirm').classList.add('hidden');
  try{
    if(d.used || !d.impId){ // nova tentativa = nova linha no histórico (nunca reusa a anterior)
      const { data, error } = await db.rpc('reimprimir_etiqueta', { p_lote_id:d.l.id, p_motivo:d.used ? 'nova tentativa de envio à impressora' : 'impressão a partir do histórico', p_copias:d.copias });
      if(error){ setPrintStatus(msgErro(error), true); return; }
      d.impId = data.impressao_id;
    }
    setPrintStatus('Preparando a imagem…');
    const url = URL.createObjectURL(await svgToB1Blob(d.svg));
    try{
      await Niimbot.printImage(url, { model:modeloNiim(), size:NIIM_SIZE, copies:d.copias, onProgress:s => setPrintStatus(typeof s === 'string' ? s : 'Imprimindo…') });
    } finally { setTimeout(() => URL.revokeObjectURL(url), 4000); }
    d.used = true;
    await registrar(d.impId, 'enviada_ao_aparelho');
    setPrintStatus('Enviada à impressora. Confira o papel e confirme abaixo.');
    $('etqConfirm').classList.remove('hidden');
    $('etqPrintBtn').textContent = '🖨️ Imprimir de novo';
  }catch(e){
    const m = (e && e.message) || String(e);
    if((e && e.name === 'NotFoundError') || /cancel/i.test(m)){ setPrintStatus('Nenhuma impressora escolhida. Ligue a B1 e toque em imprimir de novo. Se ela não aparece na lista, use "Mostrar todos os dispositivos" na aba Imprimir.', true); }
    else {
      if(/disconnect|link dropped|not connected/i.test(m)) estadoImpressora(null);
      d.used = true;
      await registrar(d.impId, 'falha', m.slice(0, 300));
      setPrintStatus('Falha ao imprimir: ' + m + ' — confira o papel; algumas etiquetas podem ter saído.', true);
      $('etqPrintBtn').textContent = '🖨️ Tentar de novo';
    }
  } finally {
    d.busy = false; $('etqPrintBtn').disabled = false; carregarHistorico();
  }
}
// ---------- reconhecer a impressora (Web Bluetooth: Chrome/Edge no Windows e Android, em HTTPS) ----------
function modeloNiim(){ return E.todos ? Object.assign({}, NIIM_MODEL, { name_prefixes:[] }) : NIIM_MODEL; }
function estadoImpressora(info, msg, erro){
  E.printer = info || null;
  const el = $('etqPrinterState'); if(!el) return;
  el.textContent = msg || (info ? `✅ ${info.label} conectada (${info.dpi} dpi)${info.deviceName ? ' · ' + info.deviceName : ''}` : '🖨️ Impressora: não conectada');
  el.style.color = erro ? 'var(--bad)' : (info ? 'var(--ok)' : '');
  $('etqPrinterBox').classList.toggle('conectada', !!info);
  $('etqConectarBtn').textContent = info ? 'Trocar impressora' : '🔌 Conectar impressora';
}
async function conectarImpressora(todos){
  if(E.conectando) return;
  if(!window.Niimbot || !Niimbot.isSupported()){
    estadoImpressora(null, 'Este navegador não tem Bluetooth. No Windows e no Android use Chrome ou Edge (em HTTPS); no iPhone, o app Bluefy.', true); return;
  }
  E.todos = !!todos; E.conectando = true;
  $('etqConectarBtn').disabled = true; $('etqConectarTodos').disabled = true;
  estadoImpressora(null, '🔎 Procurando a impressora… escolha-a na janela do navegador.');
  try{
    const p = await Niimbot.identify(modeloNiim());
    if(!p || p.task !== 'b1' || p.dpi !== 203){
      const nome = p && p.label ? p.label : 'modelo desconhecido';
      try{ await Niimbot.disconnect(); }catch(_){}
      estadoImpressora(null, `Reconhecida: ${nome}. Por enquanto o painel só imprime na Niimbot B1 (203 dpi).`, true);
    } else estadoImpressora(p);
  }catch(e){
    const m = (e && e.message) || String(e);
    if((e && e.name === 'NotFoundError') || /cancel/i.test(m)) estadoImpressora(null, 'Nenhuma impressora escolhida. Ligue a B1 (e feche o app da Niimbot) e tente de novo. Se ela não aparece na lista, toque em "Mostrar todos os dispositivos".', true);
    else estadoImpressora(null, 'Não consegui conectar: ' + m, true);
  } finally {
    E.conectando = false; $('etqConectarBtn').disabled = false; $('etqConectarTodos').disabled = false;
  }
}
async function confirmarPapel(ok){
  const d = E.dlg; if(!d || !d.impId) return;
  let obs = null;
  if(!ok){ obs = (prompt('O que aconteceu? (opcional)') || '').trim() || 'não saiu ou saiu errado'; }
  if(await registrar(d.impId, ok ? 'conferida' : 'falha', obs)){
    $('etqConfirm').classList.add('hidden');
    setPrintStatus(ok ? '✅ Impressão conferida no papel.' : 'Registrado como falha. Use "Imprimir de novo" se precisar.', !ok);
    carregarHistorico();
  }
}

// ---------- histórico ----------
async function carregarHistorico(){
  const box = $('etqHistLista');
  const { data, error } = await db.from('etiqueta_lotes')
    .select('*, etiqueta_impressoes(id,copias,motivo,situacao,created_at)')
    .order('created_at', { ascending:false }).limit(100);
  if(error){ box.innerHTML = '<p class="muted">Erro ao carregar: ' + esc(error.message) + '</p>'; return; }
  E.lotes = data || [];
  renderHistorico();
}
function renderHistorico(){
  const box = $('etqHistLista'), term = ($('etqHistBusca').value || '').toLowerCase();
  const lista = E.lotes.filter(l => (l.prep_nome + ' ' + l.lote).toLowerCase().includes(term));
  if(!lista.length){ box.innerHTML = '<p class="muted">Nenhuma etiqueta emitida ainda.</p>'; return; }
  const agora = Date.now();
  box.innerHTML = lista.map(l => {
    const venc = new Date(l.validade_em).getTime() < agora;
    const st = l.situacao === 'cancelada' ? ['cancelada', 'b-none'] : venc ? ['vencida', 'b-bad'] : ['dentro da validade', 'b-ok'];
    const imps = (l.etiqueta_impressoes || []).slice().sort((a, b) => a.created_at < b.created_at ? 1 : -1);
    const ult = imps[0];
    const quem = (l.emitido_por_email || '').split('@')[0];
    return `<div class="etq-hist">
      <div class="etq-hist-head"><strong>${esc(l.prep_nome)}</strong><span class="badge ${st[1]}">${st[0]}</span></div>
      <div class="muted">Lote ${esc(l.lote)} · FAB ${fmtCurta(l.fabricado_em)} · VAL ${fmtCurta(l.validade_em)}</div>
      ${l.peso_liquido_g != null ? `<div class="muted">Líquido ${fmtKg(l.peso_liquido_g)} (balança ${fmtKg(l.peso_bruto_g)} − ${l.cuba_nome ? 'cuba ' + esc(l.cuba_nome) + ' ' + fmtKg(l.tara_g) : 'sem cuba'})</div>` : ''}
      <div class="muted">Emitida por ${esc(quem || '—')} · ${imps.length} tentativa(s)${ult ? ' · ' + esc(SITUACAO[ult.situacao] || ult.situacao) : ''}</div>
      <div class="etq-hist-btns">
        <button type="button" class="ghost" data-act="ver" data-id="${esc(l.id)}">Ver / baixar</button>
        ${l.situacao === 'ativa' ? `<button type="button" class="ghost" data-act="reimprimir" data-id="${esc(l.id)}">Reimprimir</button>` : ''}
      </div></div>`;
  }).join('');
}
async function reimprimir(l){
  const motivo = (prompt('Motivo da reimpressão (obrigatório):') || '').trim();
  if(!motivo) return;
  const n = parseInt(prompt('Quantas cópias? (1 a 50)', '1'), 10);
  if(!(n >= 1 && n <= 50)){ toast('Cópias deve ser de 1 a 50.', false); return; }
  const { data, error } = await db.rpc('reimprimir_etiqueta', { p_lote_id:l.id, p_motivo:motivo, p_copias:n });
  if(error){ toast(msgErro(error), false); return; }
  toast('Reimpressão registrada.');
  abrirDialog(data.lote, n, data.impressao_id);
  carregarHistorico();
}

// ---------- validades (admin) ----------
function renderValidades(){
  const tb = $('etqValBody'); if(!tb) return;
  const ordem = E.preps.slice().sort((a, b) => (pronto(E.regras[a.id]) ? 1 : 0) - (pronto(E.regras[b.id]) ? 1 : 0) || a.nome.localeCompare(b.nome));
  const pend = E.preps.filter(p => !pronto(E.regras[p.id])).length;
  $('etqSubValidades').textContent = pend ? `Validades (${pend} pendente${pend > 1 ? 's' : ''})` : 'Validades';
  if(!ordem.length){ tb.innerHTML = '<tr><td colspan="5" class="muted">Nenhum prep cadastrado. Use "Novo prep" acima.</td></tr>'; return; }
  tb.innerHTML = ordem.map(p => {
    const r = E.regras[p.id] || {};
    const opts = `<option value="">— sem validade —</option>` + Object.entries(MODOS).map(([k, v]) => `<option value="${k}"${r.modo === k ? ' selected' : ''}>${v}</option>`).join('');
    const semDur = !r.modo || r.modo === 'consumo_dia';
    return `<tr data-id="${esc(p.id)}"><td><strong>${esc(p.nome)}</strong>${pronto(r) ? '' : ' <span class="badge b-warn">pendente</span>'}</td>
      <td><select class="v-modo">${opts}</select></td>
      <td><input type="number" class="v-dur num" min="1" step="1" value="${r.duracao ?? ''}"${semDur ? ' disabled' : ''}></td>
      <td style="text-align:center;"><input type="checkbox" class="v-ativa"${r.ativa === false ? '' : ' checked'}></td>
      <td><button type="button" class="primary v-salvar">Salvar</button></td></tr>`;
  }).join('');
}
async function salvarValidade(tr){
  const id = tr.dataset.id, modo = tr.querySelector('.v-modo').value || null;
  const durV = parseInt(tr.querySelector('.v-dur').value, 10);
  const ativa = tr.querySelector('.v-ativa').checked;
  let duracao = null;
  if(modo === 'horas' || modo === 'dias_ate_2359'){
    if(!(durV >= 1)){ toast('Informe a duração (número inteiro, mínimo 1).', false); return; }
    duracao = durV;
  }
  const { data, error } = await db.from('etiqueta_regras')
    .update({ modo, duracao, ativa, atualizado_por:currentUser.id, updated_at:new Date().toISOString() })
    .eq('prep_id', id).select('prep_id,modo,duracao,ativa');
  if(error){ toast('Erro ao salvar: ' + error.message, false); return; }
  if(!data || !data.length){ toast('Não foi possível salvar (sem permissão?).', false); return; }
  E.regras[id] = data[0];
  toast('Validade salva.');
  renderValidades(); renderLista();
  if(E.sel && E.sel.id === id) selecionar(E.sel, true);
}

// ---------- cubas (admin) ----------
function renderCubas(){
  const tb = $('etqCubasBody'); if(!tb) return;
  tb.innerHTML = E.cubas.length ? E.cubas.map(c => `<tr data-id="${esc(c.id)}">
      <td><input type="text" class="c-nome" maxlength="60" value="${esc(c.nome)}" style="width:100%;"></td>
      <td><input type="text" class="c-tara num" inputmode="decimal" value="${(Number(c.tara_g) / 1000).toFixed(3).replace('.', ',')}" style="width:90px;"> kg</td>
      <td style="text-align:center;"><input type="checkbox" class="c-ativa"${c.ativa ? ' checked' : ''}></td>
      <td><button type="button" class="primary c-salvar">Salvar</button></td></tr>`).join('')
    : '<tr><td colspan="4" class="muted">Nenhuma cuba cadastrada. Pese a cuba vazia e cadastre acima.</td></tr>';
}
async function lerCuba(nomeEl, taraEl){
  const nome = nomeEl.value.trim(); let tara = parseKg(taraEl.value);
  if(!nome){ toast('Informe o nome da cuba.', false); return null; }
  if(isNaN(tara) || tara <= 0){ toast('Tara inválida. Digite em kg, por exemplo 1,250.', false); return null; }
  const v = await ValorExtenso.conferir(tara, { campo:'Tara da cuba', unidade:'kg', limite:TARA_LIMITE_G, maximo:TARA_MAX_G });
  if(v == null){ taraEl.focus(); return null; }
  if(v !== tara){ tara = v; taraEl.value = kgCampo(v); }
  return { nome, tara_g:tara };
}
async function novaCuba(){
  const v = await lerCuba($('etqCubaNome'), $('etqCubaTara')); if(!v) return;
  const { error } = await db.from('cubas').insert(v);
  if(error){ toast(error.code === '23505' ? 'Já existe uma cuba com esse nome.' : 'Erro ao salvar: ' + error.message, false); return; }
  $('etqCubaNome').value = ''; $('etqCubaTara').value = '';
  toast('Cuba cadastrada.'); carregar();
}
async function salvarCuba(tr){
  const v = await lerCuba(tr.querySelector('.c-nome'), tr.querySelector('.c-tara')); if(!v) return;
  v.ativa = tr.querySelector('.c-ativa').checked; v.atualizado_por = currentUser.id; v.updated_at = new Date().toISOString();
  const { data, error } = await db.from('cubas').update(v).eq('id', tr.dataset.id).select('id');
  if(error){ toast(error.code === '23505' ? 'Já existe uma cuba com esse nome.' : 'Erro ao salvar: ' + error.message, false); return; }
  if(!data || !data.length){ toast('Não foi possível salvar (sem permissão?).', false); return; }
  toast('Cuba salva.'); carregar();
}

// ---------- ligações ----------
function subtab(nome){
  document.querySelectorAll('.etq-sub button').forEach(b => b.classList.toggle('active', b.dataset.sub === nome));
  ['imprimir', 'historico', 'validades', 'cubas'].forEach(n => $('etq-' + n).classList.toggle('hidden', n !== nome));
  if(nome === 'historico') carregarHistorico();
  requestAnimationFrame(() => window.updateStickyOffsets && updateStickyOffsets());
}
document.querySelectorAll('.etq-sub button').forEach(b => b.addEventListener('click', () => subtab(b.dataset.sub)));
$('etqBusca').addEventListener('input', renderLista);
$('etqPreps').addEventListener('click', e => { const b = e.target.closest('.etq-prep'); if(!b) return; const p = E.preps.find(x => x.id === b.dataset.id); if(p) selecionar(p); });
$('etqFab').addEventListener('input', mudouCampo);
$('etqLote').addEventListener('input', mudouCampo);
$('etqPeso').addEventListener('input', mudouCampo);
$('etqPeso').addEventListener('change', conferirPeso);
$('etqCuba').addEventListener('change', mudouCampo);
$('etqCubaAdd') && $('etqCubaAdd').addEventListener('click', novaCuba);
$('etqCubasBody') && $('etqCubasBody').addEventListener('click', e => { const b = e.target.closest('.c-salvar'); if(b) salvarCuba(b.closest('tr')); });
$('etqMenos').addEventListener('click', () => { E.copias = Math.max(1, E.copias - 1); $('etqCopias').textContent = E.copias; E.reqId = uuid(); });
$('etqMais').addEventListener('click', () => { E.copias = Math.min(50, E.copias + 1); $('etqCopias').textContent = E.copias; E.reqId = uuid(); });
$('etqEmitirBtn').addEventListener('click', emitir);
$('etqHistBusca').addEventListener('input', renderHistorico);
$('etqHistLista').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if(!b) return;
  const l = E.lotes.find(x => x.id === b.dataset.id); if(!l) return;
  if(b.dataset.act === 'ver') abrirDialog(l, l.copias); else reimprimir(l);
});
$('etqConectarBtn').addEventListener('click', () => conectarImpressora(false));
$('etqConectarTodos').addEventListener('click', () => conectarImpressora(true));
$('etqPrintBtn').addEventListener('click', imprimirNiimbot);
$('etqOk').addEventListener('click', () => confirmarPapel(true));
$('etqFail').addEventListener('click', () => confirmarPapel(false));
$('etqDialogBaixar').addEventListener('click', () => { if(E.dlg) baixarPng(E.dlg.svg, `etiqueta-${E.dlg.l.prep_nome}-${E.dlg.l.lote}`); });
$('etqDialogFechar').addEventListener('click', () => { const d = $('etqDialog'); if(d.close) d.close(); else d.removeAttribute('open'); });
const nv = $('etqNovoPrep'); if(nv) nv.addEventListener('click', () => document.querySelector('.tab[data-tab="pcp"]').click());
$('etqValBody') && $('etqValBody').addEventListener('change', e => {
  if(!e.target.classList.contains('v-modo')) return;
  const tr = e.target.closest('tr'), d = tr.querySelector('.v-dur'), m = e.target.value;
  d.disabled = !(m === 'horas' || m === 'dias_ate_2359');
  if(d.disabled) d.value = '';
});
$('etqValBody') && $('etqValBody').addEventListener('click', e => { const b = e.target.closest('.v-salvar'); if(b) salvarValidade(b.closest('tr')); });

window.loadEtiquetas = carregar;
window.__etq = { calcValidade, buildLabel, fmtCurta, fromInputSP, toInputSP, parseKg, fmtKg };
})();
