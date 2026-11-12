// Confere valores absurdos de peso/volume (típico de vírgula esquecida: 5800 em vez de 5,800)
// e pergunta por extenso antes de aceitar. Sem dependências. Expõe window.ValorExtenso.
(function(root){
'use strict';
const U = ['zero','um','dois','três','quatro','cinco','seis','sete','oito','nove','dez','onze','doze','treze','quatorze','quinze','dezesseis','dezessete','dezoito','dezenove'];
const D = ['','','vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'];
const C = ['','cento','duzentos','trezentos','quatrocentos','quinhentos','seiscentos','setecentos','oitocentos','novecentos'];
function ate999(n){
  if(n === 100) return 'cem';
  const p = [];
  if(n >= 100){ p.push(C[Math.floor(n / 100)]); n %= 100; }
  if(n >= 20){ p.push(D[Math.floor(n / 10)] + (n % 10 ? ' e ' + U[n % 10] : '')); }
  else if(n > 0 || !p.length) p.push(U[n]);
  return p.join(' e ');
}
// Inteiros de 0 a 999.999
function extenso(n){
  n = Math.round(n);
  if(n < 1000) return ate999(n);
  const mil = Math.floor(n / 1000), r = n % 1000;
  const m = mil === 1 ? 'mil' : ate999(mil) + ' mil';
  if(!r) return m;
  return m + (r < 100 || r % 100 === 0 ? ' e ' : ' ') + ate999(r);
}
const NOMES = { kg:['quilo','quilos','grama','gramas'], l:['litro','litros','mililitro','mililitros'] };
// Milésimos da unidade (gramas ou mililitros) -> "cinco quilos e oitocentos gramas"
function extensoMedida(mil, unidade){
  const n = NOMES[unidade] || NOMES.kg; mil = Math.round(mil);
  const a = Math.floor(mil / 1000), b = mil % 1000, p = [];
  if(a) p.push(extenso(a) + ' ' + (a === 1 ? n[0] : n[1]));
  if(b || !a) p.push(extenso(b) + ' ' + (b === 1 ? n[2] : n[3]));
  return p.join(' e ');
}
const fmt = (mil, unidade) => (mil / 1000).toLocaleString('pt-BR', { minimumFractionDigits:mil % 1000 ? 3 : 0, maximumFractionDigits:3 }) + ' ' + unidade;

let dlg = null;
function montar(){
  if(dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = 'vxDialog';
  dlg.style.cssText = 'border:none;border-radius:14px;padding:18px;max-width:440px;width:calc(100% - 32px);box-shadow:0 8px 30px rgba(0,0,0,.35);font-family:inherit;';
  dlg.innerHTML = '<h3 style="margin:0 0 8px;font-size:17px;">⚠️ Esse valor está certo?</h3>' +
    '<p id="vxTexto" style="margin:0 0 6px;font-size:14px;"></p>' +
    '<p id="vxExtenso" style="margin:0 0 14px;font-size:18px;font-weight:800;"></p>' +
    '<div id="vxBotoes" style="display:flex;flex-direction:column;gap:8px;"></div>';
  document.body.appendChild(dlg);
  return dlg;
}
// Devolve Promise<number|null>: o valor aceito em milésimos (g ou ml), ou null se a pessoa vai corrigir.
// opts: { campo, unidade:'kg'|'l', limite (acima disso pergunta), maximo (acima disso não aceita) }
function conferir(mil, opts){
  opts = opts || {};
  const unidade = opts.unidade || 'kg', limite = opts.limite, maximo = opts.maximo || Infinity;
  mil = Math.round(mil);
  if(!(mil > limite)) return Promise.resolve(mil);
  if(typeof document === 'undefined') return Promise.resolve(null);
  const d = montar(), sug = Math.round(mil / 1000);   // vírgula esquecida: 5800 -> 5,800
  const sugOk = sug >= 100 && sug <= limite;   // só sugere se o resultado for plausível (a partir de 100 g/ml)
  d.querySelector('#vxTexto').textContent = `Você digitou ${fmt(mil, unidade)}${opts.campo ? ' em "' + opts.campo + '"' : ''}. Por extenso, isso é:`;
  d.querySelector('#vxExtenso').textContent = extensoMedida(mil, unidade) + (mil > maximo ? ' — acima do máximo aceito.' : '');
  const box = d.querySelector('#vxBotoes'); box.innerHTML = '';
  return new Promise(resolve => {
    const fim = v => { d.removeEventListener('cancel', onCancel); if(d.close) d.close(); else d.removeAttribute('open'); resolve(v); };
    const onCancel = e => { e.preventDefault(); fim(null); };
    const botao = (texto, valor, cls) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.style.cssText = 'min-height:48px;font-size:14.5px;text-align:left;padding:8px 14px;'; b.textContent = texto; b.addEventListener('click', () => fim(valor)); box.appendChild(b); };
    if(sugOk) botao(`Não. Faltou a vírgula: é ${fmt(sug, unidade)} (${extensoMedida(sug, unidade)})`, sug, 'primary');
    botao('Não. Vou corrigir o valor', null, sugOk ? 'ghost' : 'primary');
    if(mil <= maximo) botao(`Sim, é isso mesmo: ${fmt(mil, unidade)}`, mil, 'ghost');
    d.addEventListener('cancel', onCancel);
    if(d.showModal) d.showModal(); else d.setAttribute('open', '');
  });
}
root.ValorExtenso = { extenso, extensoMedida, conferir, fmt };
})(typeof window !== 'undefined' ? window : globalThis);
