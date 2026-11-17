/* Planificación Pool Concept: código de la app (se carga desde app.html) */
const TIPOS = ['Fabricación', 'Instalación', 'Reparación'];
const CLASE = { 'Fabricación': 'fab', 'Instalación': 'ins', 'Reparación': 'rep' };
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function hoyIso() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
const HOY = hoyIso();

const E = {
  tareas: [], festivos: new Map(), equipos: [],
  anio: +HOY.slice(0, 4), mes: +HOY.slice(5, 7) - 1,
  vista: (() => {
    try { const v = localStorage.getItem('plan-vista'); if (['mes', 'semana', 'lista', 'compras'].includes(v)) return v; } catch (e) {}
    return matchMedia('(max-width: 640px)').matches ? 'semana' : 'mes';
  })(),
  filtroEquipo: '',
  compras: { materiales: [], ubicaciones: [], bom: [], pedidos: [] }, matMap: new Map(),
  plan: { porFab: new Map(), aPedir: [] },
  subCompras: (() => { try { return localStorage.getItem('plan-sub-compras') || 'pedir'; } catch (e) { return 'pedir'; } })(),
  filtro: new Set(TIPOS), dia: HOY,
  busqueda: '', verTerminadas: false, editId: null, cargado: false
};

/* ---------- Fechas ---------- */
function utc(iso) { const p = iso.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
function aIso(d) { return d.toISOString().slice(0, 10); }
function sumar(iso, n) { const d = utc(iso); d.setUTCDate(d.getUTCDate() + n); return aIso(d); }
function finde(iso) { const w = utc(iso).getUTCDay(); return w === 0 || w === 6; }
function laborable(iso) { return !finde(iso) && !E.festivos.has(iso); }
function siguienteLab(iso) { let d = iso; for (let i = 0; i < 60 && !laborable(d); i++) d = sumar(d, 1); return d; }
function calcularFin(inicio, dur) {
  let d = inicio, n = 0, sf = 0, sfest = 0;
  for (let i = 0; i < 3000; i++) {
    if (laborable(d)) { n++; if (n >= dur) return { fin: d, finde: sf, festivos: sfest }; }
    else if (finde(d)) sf++;
    else sfest++;
    d = sumar(d, 1);
  }
  return null;
}
const fLargo = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const fCorto = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const esFecha = iso => /^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''));
const largo = iso => { if (!esFecha(iso)) return '(sin fecha)'; const s = fLargo.format(utc(iso)); return s.charAt(0).toUpperCase() + s.slice(1); };
const corto = iso => (esFecha(iso) ? fCorto.format(utc(iso)) : '(sin fecha)');
const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);

/* ---------- Servidor ---------- */
function llamar(fn, ...args) {
  return new Promise((ok, ko) => google.script.run.withSuccessHandler(ok).withFailureHandler(ko)[fn](...args));
}
function aplicar(d) {
  marcarActualizado();
  E.tareas = d.tareas || [];
  E.festivos = new Map((d.festivos || []).map(f => [f.fecha, f]));
  E.equipos = d.equipos || [];
  E.historial = d.historial || [];
  E.facturas = d.facturas || [];
  E.compras = d.compras || { materiales: [], ubicaciones: [], bom: [], pedidos: [] };
  E.matMap = new Map((E.compras.materiales || []).map(m => [m.producto, m]));
  $('#dlMateriales').innerHTML = (E.compras.materiales || []).map(m => `<option value="${esc(m.producto)}">${esc(m.proveedor || '')}</option>`).join('');
  E.usuario = d.usuario || '';
  E.cargado = true;
  $('#dlEquipos').innerHTML = E.equipos.map(x => `<option value="${esc(x)}">`).join('');
  const proys = [...new Set(E.tareas.map(t => t.proyecto))].sort((a, b) => a.localeCompare(b, 'es'));
  $('#dlProyectos').innerHTML = proys.map(x => `<option value="${esc(x)}">`).join('');
  render();
}

/* ---------- Pintado ---------- */
const pasaEquipo = t => !E.filtroEquipo || normEq(t.equipo) === normEq(E.filtroEquipo);
const visibles = () => E.tareas.filter(t => E.filtro.has(t.tipo) && pasaEquipo(t));

/* ---------- Avisos: equipos ocupados e instalaciones antes de su fabricación ---------- */
const ICO = {
  aviso: '<svg class="ico ico-aviso" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 1.5 21h21L12 2.5z" fill="currentColor"/><path d="M12 9.5v5.5M12 18v.01" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>',
  enlace: '<svg class="ico ico-enlace" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>'
};
const normEq = s => String(s || '').trim().toLowerCase();
function seSolapan(a, b) {
  const ini = a.inicio > b.inicio ? a.inicio : b.inicio;
  const fin = a.fin < b.fin ? a.fin : b.fin;
  for (let d = ini; d <= fin; d = sumar(d, 1)) if (laborable(d)) return true;
  return false;
}
function choquesDe(t) {
  if (!normEq(t.equipo) || t.estado === 'Terminada') return [];
  return E.tareas.filter(o => o.id !== t.id && o.estado !== 'Terminada' && normEq(o.equipo) === normEq(t.equipo) && seSolapan(t, o));
}
function fabDe(t) {
  return t.tipo === 'Instalación' && t.dependeDe ? (E.tareas.find(x => x.id === t.dependeDe && x.tipo === 'Fabricación') || null) : null;
}
function antesDeFab(t) { const f = fabDe(t); return f && t.estado !== 'Terminada' && t.inicio <= f.fin ? f : null; }
function instalacionesDe(fabId) { return E.tareas.filter(t => t.tipo === 'Instalación' && t.dependeDe === fabId); }
const retrasada = t => t.estado !== 'Terminada' && t.fin < HOY;
function calcularAvisos() {
  E.avisos = new Map();
  E.tareas.forEach(t => {
    const c = choquesDe(t), f = antesDeFab(t), r = retrasada(t);
    const pm = E.plan.porFab.get(t.id), mat = pm && pm.estado === 'tarde' ? pm : null;
    if (c.length || f || r || mat) E.avisos.set(t.id, { choques: c, fab: f, retraso: r, mat });
  });
}
function lineasAviso(a, t) {
  const l = [];
  if (a.retraso && t) l.push(`Retrasada: debía acabar el ${dm(t.fin)} y no está marcada como terminada`);
  else if (a.retraso) l.push('Retrasada: ya pasó su fecha de fin y no está marcada como terminada');
  l.push(...a.choques.map(o => `${o.equipo} también está en ${o.proyecto} (${dm(o.inicio)} – ${dm(o.fin)})`));
  if (a.mat) l.push(`Material: ${textoMat(a.mat)}`);
  if (a.fab) l.push(`Empieza antes de que termine su fabricación (${a.fab.proyecto}, acaba el ${dm(a.fab.fin)})`);
  return l;
}
const nombreUsuario = u => String(u || '').split('@')[0] || 'alguien';
function fechaHora(s) { const d = new Date(s); return isNaN(d) ? s : d.getDate() + ' ' + MESES[d.getMonth()].slice(0, 3).toLowerCase() + ', ' + fHora.format(d); }

/* ---------- Filtro por equipo ---------- */
function listaEquipos() {
  const m = new Map();
  [...E.equipos, ...E.tareas.map(t => t.equipo)].forEach(x => { const k = normEq(x); if (k && !m.has(k)) m.set(k, String(x).trim()); });
  return [...m.values()].sort((a, b) => a.localeCompare(b, 'es'));
}
function selEquipoHTML() {
  return `<label class="sel-eq${E.filtroEquipo ? ' activo' : ''}"><span>Equipo</span><select data-filtro-equipo>
    <option value="">Todos</option>${listaEquipos().map(x =>
      `<option value="${esc(x)}"${normEq(x) === normEq(E.filtroEquipo) ? ' selected' : ''}>${esc(x)}</option>`).join('')}
  </select></label>`;
}
document.addEventListener('change', e => {
  const s = e.target.closest('[data-filtro-equipo]');
  if (s) { E.filtroEquipo = s.value; render(); }
});

/* ---------- Vista «Hoy y esta semana» ---------- */
const fSem = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
ICO.check = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
ICO.mapa = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
function htmlSemana() {
  const dias = [];
  for (let d = laborable(HOY) ? HOY : siguienteLab(HOY); dias.length < 7; d = sumar(d, 1)) if (laborable(d)) dias.push(d);
  const vs = visibles().filter(t => t.estado !== 'Terminada');
  const manana = sumar(HOY, 1);
  let h = '';
  const atrasadas = visibles().filter(retrasada).sort((a, b) => a.fin.localeCompare(b.fin));
  if (atrasadas.length) {
    h += `<section class="sem-dia sem-retraso"><h2>${ICO.aviso}Retrasadas<small>${plural(atrasadas.length, 'tarea sin terminar', 'tareas sin terminar')}</small></h2>
      <div class="sem-lista">${atrasadas.map(t => tarjetaSemana(t, null)).join('')}</div></section>`;
  }
  if (!laborable(HOY)) {
    const f = E.festivos.get(HOY);
    h += `<p class="nota">Hoy no es laborable${f && !finde(HOY) ? ' (' + esc(f.descripcion) + ')' : ''}. Estos son los próximos días de trabajo.</p>`;
  }
  dias.forEach(d => {
    const ts = vs.filter(t => t.inicio <= d && d <= t.fin)
      .sort((a, b) => normEq(a.equipo).localeCompare(normEq(b.equipo), 'es') || TIPOS.indexOf(a.tipo) - TIPOS.indexOf(b.tipo));
    const fecha = fSem.format(utc(d));
    const pre = d === HOY ? 'Hoy' : d === manana ? 'Mañana' : '';
    h += `<section class="sem-dia${d === HOY ? ' es-hoy' : ''}"><h2>${pre || fecha.charAt(0).toUpperCase() + fecha.slice(1)}${pre ? `<small>${fecha}</small>` : ''}</h2>`;
    h += ts.length ? `<div class="sem-lista">${ts.map(t => tarjetaSemana(t, d)).join('')}</div>` : `<p class="sem-vacio">Sin tareas.</p>`;
    h += '</section>';
  });
  return h;
}
function tarjetaSemana(t, d) {
  const av = E.avisos.get(t.id);
  const maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(t.ubicacion);
  return `<article class="sem-t t-${CLASE[t.tipo]}" data-id="${esc(t.id)}" tabindex="0" aria-label="Abrir ${esc(t.tipo)}: ${esc(t.proyecto)}">
    <div class="sem-cab"><span class="tipo">${t.tipo}${t.estado === 'En curso' ? ', en curso' : ''}</span>${d
      ? `<span class="dias">Día ${contarLab(t.inicio, d)} de ${t.duracion}</span>`
      : `<span class="dias tarde">Debía acabar el ${dm(t.fin)}</span>`}</div>
    <span class="proy">${av ? ICO.aviso : ''}${esc(t.proyecto)}</span>
    ${t.equipo ? `<span class="eq">${esc(t.equipo)}</span>` : ''}
    ${t.observaciones ? `<span class="obs">${esc(t.observaciones)}</span>` : ''}
    <div class="sem-acc">
      ${t.ubicacion ? `<a class="sem-mapa" href="${maps}" target="_blank" rel="noopener">${ICO.mapa}Cómo llegar: ${esc(t.ubicacion)}</a>` : ''}
      <button type="button" class="btn-terminar" data-terminar="${esc(t.id)}">${ICO.check}Terminar</button>
    </div>
  </article>`;
}

/* ---------- Facturación ---------- */
// Euros con separador de miles siempre (7.300 €) y céntimos solo si los hay (1.800,50 €)
const fEur0 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: 'always' });
const fEur2 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
const eur = n => { const r = Math.round(n * 100) / 100; return (Number.isInteger(r) ? fEur0 : fEur2).format(r); };
const facturasDe = id => (E.facturas || []).filter(f => f.tarea === id).sort((a, b) => a.fecha.localeCompare(b.fecha));
// Suma de las facturas con fecha en ese mes (solo de tareas que existen)
function facturacionMes(anio, mes) {
  const pref = `${anio}-${pad(mes + 1)}`;
  const ids = new Set(E.tareas.map(t => t.id));
  const l = (E.facturas || []).filter(f => f.fecha.startsWith(pref) && ids.has(f.tarea));
  return { total: l.reduce((s, f) => s + f.importe, 0), n: l.length };
}
function pintarTitulo() {
  $('#mesTitulo').innerHTML = `${MESES[E.mes]} <span>${E.anio}</span>`;
  const f = facturacionMes(E.anio, E.mes);
  $('#mesFact').innerHTML = f.n
    ? `Facturación: <b>${eur(f.total)}</b>, ${plural(f.n, 'factura', 'facturas')}`
    : 'Facturación: <b>0 €</b>';
}

function regletaHTML() {
  const inicioMes = `${E.anio}-${pad(E.mes + 1)}-01`;
  const finMes = aIso(new Date(Date.UTC(E.anio, E.mes + 1, 0)));
  return TIPOS.map(tp => {
    const n = E.vista === 'mes'
      ? E.tareas.filter(t => t.tipo === tp && pasaEquipo(t) && t.inicio <= finMes && t.fin >= inicioMes).length
      : E.tareas.filter(t => t.tipo === tp && pasaEquipo(t) && (E.verTerminadas || t.fin >= HOY)).length;
    return `<button type="button" class="t-${CLASE[tp]}" data-tipo="${tp}" aria-pressed="${E.filtro.has(tp)}">
      <span class="nom">${tp}</span><span class="n">${n}</span></button>`;
  }).join('');
}

function render() {
  E.plan = planCompras();
  calcularAvisos();
  pintarTitulo();
  $('#navMes').hidden = E.vista !== 'mes';
  $('#mesHoy').hidden = E.vista !== 'mes';
  $('#regleta').hidden = E.vista === 'compras';
  document.querySelector('.fabs').hidden = E.vista === 'compras';
  $('#navLista').hidden = E.vista !== 'lista';
  document.querySelectorAll('[data-vista]').forEach(b => b.setAttribute('aria-pressed', b.dataset.vista === E.vista));
  $('#regleta').innerHTML = regletaHTML();
  if (!E.cargado) return;
  const tlPrevio = $('#tl');
  if (tlPrevio) E.tlY = tlPrevio.scrollTop;
  $('#main').innerHTML = E.vista === 'mes' ? htmlGantt()
    : E.vista === 'compras' ? htmlCompras()
    : `<div class="sem-barra">${selEquipoHTML()}</div>` + (E.vista === 'semana' ? htmlSemana() : htmlLista());
  if (E.vista === 'compras') initCrono();
  if (E.vista === 'mes') { initTL(); if (dlg.open) marcarSel(E.editId); }
}

/* ---------- Cronología (Gantt) ---------- */
const ESCALAS = { dias: 36, semanas: 14, meses: 4.5 };
const NOM_ESC = { dias: 'Días', semanas: 'Semanas', meses: 'Meses' };
let ESC = 'semanas';
try { ESC = localStorage.getItem('plan-escala') || 'semanas'; } catch (e) {}
if (!ESCALAS[ESC]) ESC = 'semanas';
const entre = (x, y) => Math.round((utc(y) - utc(x)) / 864e5);
const fDM = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dm = iso => (esFecha(iso) ? fDM.format(utc(iso)) : '(sin fecha)');
const finDeMes = iso => aIso(new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7), 0)));

function rangoTL() {
  let a = sumar(HOY, -90), b = sumar(HOY, 330);
  E.tareas.forEach(t => { if (t.inicio < a) a = t.inicio; if (t.fin > b) b = t.fin; });
  a = a.slice(0, 8) + '01';
  b = finDeMes(sumar(finDeMes(b), 1)); // un mes de margen al final
  return { a, b };
}

// Coloca las tareas de un tipo en filas sin que se pisen (barra + texto)
function repartir(ts, a, dpx) {
  const filas = [], out = [];
  ts.forEach(t => {
    const x = entre(a, t.inicio) * dpx;
    const w = (entre(t.inicio, t.fin) + 1) * dpx;
    const p = t.proyecto;
    const s = `${t.estado !== 'Pendiente' ? t.estado + ', ' : ''}${dm(t.inicio)} – ${dm(t.fin)}, ${plural(t.duracion, 'día', 'días')}${t.equipo ? ', ' + t.equipo : ''}`;
    const tw = Math.min(360, Math.max(p.length * 7.8 + 36, s.length * 6.4) + 24);
    let f = filas.findIndex(fin => fin + 8 <= x);
    if (f < 0) { f = filas.length; filas.push(0); }
    filas[f] = x + Math.max(w, tw);
    out.push({ t, x, w, f, p, s });
  });
  return { out, n: Math.max(1, filas.length) };
}

function htmlGantt() {
  const dpx = ESCALAS[ESC];
  const { a, b } = rangoTL();
  const nd = entre(a, b) + 1, W = nd * dpx;
  E.tl = { a, dpx };
  const LET = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

  const pendientes = avisosPendientes();
  let h = `<div class="tl-barra"><div class="tl-barra-izq"><div class="escala" role="group" aria-label="Escala">${
    Object.keys(ESCALAS).map(k => `<button type="button" data-escala="${k}" aria-pressed="${k === ESC}">${NOM_ESC[k]}</button>`).join('')
  }</div>${selEquipoHTML()}${pendientes.length ? `<button type="button" class="chip-aviso" id="btnAvisos"
    title="Tareas retrasadas, equipos con dos tareas a la vez o instalaciones que empiezan antes de su fabricación. Pulsa para ir a cada una.">${ICO.aviso}${plural(pendientes.length, 'aviso', 'avisos')}</button>` : ''}</div><span class="tl-ayuda"><span class="ayuda-raton">Arrastra una tarea para moverla o su borde derecho para alargarla. Arrastra el fondo o usa la barra de abajo para cambiar de mes.</span><span class="ayuda-tactil">Usa la barra de abajo o desliza el diagrama para moverte entre meses.</span></span></div>`;
  h += `<div class="tl esc-${ESC}" id="tl" style="--dpx:${dpx}px"><div class="tl-lienzo" style="width:calc(var(--izq) + ${W}px)">`;

  // Cabecera: meses y días
  h += `<div class="tl-cab"><div class="tl-esq"></div><div class="tl-escala" id="tlEscala" style="width:${W}px" title="Pulsa un día para crear una tarea">`;
  for (let m = a; m <= b; m = sumar(finDeMes(m), 1)) {
    const fm = finDeMes(m) > b ? b : finDeMes(m);
    h += `<div class="tl-mes" style="left:${entre(a, m) * dpx}px;width:${(entre(m, fm) + 1) * dpx}px"><span>${ESC === 'meses' ? MESES[+m.slice(5, 7) - 1].slice(0, 3) : MESES[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}${(() => {
      const f = facturacionMes(+m.slice(0, 4), +m.slice(5, 7) - 1);
      return f.n && ESC !== 'meses' ? `<em class="tl-fact">${eur(f.total)}</em>` : '';
    })()}</span></div>`;
  }
  for (let i = 0; i < nd; i++) {
    const d = sumar(a, i), w = utc(d).getUTCDay(), x = i * dpx;
    if (ESC === 'dias') {
      const f = E.festivos.get(d);
      const cls = ['tl-dia'];
      if (!laborable(d)) cls.push(f && !finde(d) ? 'fest' : 'nolab');
      if (d === HOY) cls.push('hoy');
      h += `<div class="${cls.join(' ')}" style="left:${x}px;width:${dpx}px"${f ? ` title="${esc(f.descripcion)}"` : ''}><span>${LET[w]}</span><b>${+d.slice(8)}</b></div>`;
    } else if (w === 1 && ESC === 'semanas') {
      h += `<div class="tl-dia lunes" style="left:${x}px;width:${dpx * 7}px"><b>${+d.slice(8)}</b></div>`;
    }
  }
  if (ESC !== 'dias' && HOY >= a && HOY <= b) h += `<span class="tl-hoyeti" style="left:${(entre(a, HOY) + .5) * dpx}px">Hoy</span>`;
  h += '</div></div>';

  // Fondo: fines de semana, festivos, cambios de mes y hoy
  h += `<div class="tl-cuerpo"><div class="tl-fondo" style="width:${W}px">`;
  let tramo = null;
  const cerrar = () => { if (tramo) h += `<span class="${tramo.c}" style="left:${tramo.i * dpx}px;width:${tramo.n * dpx}px"></span>`; tramo = null; };
  for (let i = 0; i < nd; i++) {
    const d = sumar(a, i);
    const c = laborable(d) ? '' : (E.festivos.has(d) && !finde(d) ? 'tl-fest' : 'tl-nolab');
    if (tramo && tramo.c === c) tramo.n++;
    else { cerrar(); if (c) tramo = { c, i, n: 1 }; }
  }
  cerrar();
  for (let m = sumar(finDeMes(a), 1); m <= b; m = sumar(finDeMes(m), 1)) h += `<span class="tl-raya" style="left:${entre(a, m) * dpx}px"></span>`;
  if (HOY >= a && HOY <= b) h += `<span class="tl-hoy" style="left:${(entre(a, HOY) + .5) * dpx - 1}px"></span>`;
  h += '</div>';

  // Un carril por tipo de tarea
  const tipos = TIPOS.filter(tp => E.filtro.has(tp));
  if (!tipos.length) h += `<div class="tl-vacio">Marca arriba algún tipo de tarea para verlo.</div>`;
  tipos.forEach(tp => {
    const ts = E.tareas.filter(t => t.tipo === tp && pasaEquipo(t)).sort((x, y) => x.inicio.localeCompare(y.inicio) || x.proyecto.localeCompare(y.proyecto, 'es'));
    const { out, n } = repartir(ts, a, dpx);
    h += `<div class="tl-carril t-${CLASE[tp]}"><div class="tl-nom"><div class="tl-nom-in"><b>${tp}</b><small>${plural(ts.length, 'tarea', 'tareas')}</small></div></div>
      <div class="tl-zona" style="width:${W}px;height:${n * 48 + 8}px">`;
    out.forEach(o => {
      const av = E.avisos.get(o.t.id), fab = fabDe(o.t);
      const fs = facturasDe(o.t.id);
      const tip = [o.p, o.s, o.t.ubicacion, fab ? 'Va después de: ' + fab.proyecto : '', fs.length ? `Facturas: ${fs.map(f => dm(f.fecha) + ' ' + eur(f.importe)).join(', ')}` : '', E.plan.porFab.has(o.t.id) && E.plan.porFab.get(o.t.id).estado !== 'tarde' ? 'Materiales: ' + textoMat(E.plan.porFab.get(o.t.id)) : '', ...(av ? lineasAviso(av, o.t).map(x => '⚠ ' + x) : [])].filter(Boolean).join('\n');
      const cls = 'tl-tarea' + (av ? ' choque' : '') + (o.t.estado === 'Terminada' ? ' terminada' : '') + (o.t.estado === 'En curso' ? ' encurso' : '');
      h += `<div class="${cls}" data-id="${esc(o.t.id)}" tabindex="0" role="button" title="${esc(tip)}"
        aria-label="Editar ${esc(tp)}: ${esc(o.p)}, ${esc(o.s)}" style="left:${o.x}px;top:${8 + o.f * 48}px">
        <span class="fondo" style="width:${o.w}px"></span><span class="tirador" style="left:${o.w}px" title="Arrastra para cambiar la duración"></span>
        <span class="txt"><span class="p">${av ? ICO.aviso : ''}${fab ? ICO.enlace : ''}${esc(o.p)}</span><span class="s">${esc(o.s)}</span></span></div>`;
    });
    h += '</div></div>';
  });
  h += '</div></div></div>';
  h += `<div class="tl-desliz"><span>${MESES[+a.slice(5, 7) - 1].slice(0, 3)} ${a.slice(0, 4)}</span>
    <input type="range" id="tlRango" min="0" max="1000" step="1" value="0" aria-label="Moverse por los meses">
    <span>${MESES[+b.slice(5, 7) - 1].slice(0, 3)} ${b.slice(0, 4)}</span></div>`;
  return h;
}

// Coloca la vista y sigue el desplazamiento para actualizar el mes del título
function initTL() {
  const el = $('#tl'); if (!el) return;
  const { a, dpx } = E.tl;
  const izq = () => el.querySelector('.tl-esq').offsetWidth;
  const ancho = () => el.clientWidth - izq();
  ajustarAlto(el);
  el.scrollTop = E.tlY || 0;
  // El punto de referencia (y el mes del título) está a un cuarto del ancho visible
  el.scrollLeft = entre(a, E.tlCentro || HOY) * dpx - ancho() * 0.25;
  const actualizar = () => {
    const c = sumar(a, Math.floor((el.scrollLeft + ancho() * 0.25) / dpx));
    E.tlCentro = c;
    const anio = +c.slice(0, 4), mes = +c.slice(5, 7) - 1;
    if (anio !== E.anio || mes !== E.mes) {
      E.anio = anio; E.mes = mes;
      pintarTitulo();
      $('#regleta').innerHTML = regletaHTML();
    }
  };
  let pend = false;
  el.addEventListener('scroll', () => { if (!pend) { pend = true; requestAnimationFrame(() => { pend = false; actualizar(); }); } }, { passive: true });
  actualizar();
  // Barra deslizante de debajo: mueve el diagrama por los meses
  const rango = $('#tlRango');
  const maxX = () => Math.max(1, el.scrollWidth - el.clientWidth);
  const sinc = () => { rango.value = Math.round(el.scrollLeft / maxX() * 1000); };
  el.addEventListener('scroll', sinc, { passive: true });
  rango.addEventListener('input', () => { el.scrollLeft = rango.value / 1000 * maxX(); });
  sinc();
  // Arrastrar con el ratón
  el.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const nodo = e.target.closest('.tl-tarea');
    if (nodo) { // mover o alargar una tarea
      const t = E.tareas.find(x => x.id === nodo.dataset.id); if (!t) return;
      e.preventDefault();
      Object.assign(BAR, {
        nodo, t, el, dpx, x: e.clientX, n: 0, movido: false,
        modo: e.target.closest('.tirador') ? 'alargar' : 'mover',
        left: parseFloat(nodo.style.left), fondo: nodo.querySelector('.fondo'),
        tirador: nodo.querySelector('.tirador'), w: parseFloat(nodo.querySelector('.fondo').style.width),
        texto: nodo.querySelector('.s').textContent
      });
      ARR.movido = false;
      return;
    }
    ARR.el = el; ARR.x = e.clientX; ARR.s = el.scrollLeft; ARR.movido = false;
  });
  el.addEventListener('click', e => { if (ARR.movido) { e.stopPropagation(); e.preventDefault(); ARR.movido = false; } }, true);
  // Pulsar un día de la cabecera: nueva tarea ese día
  $('#tlEscala').addEventListener('click', e => {
    const r = e.currentTarget.getBoundingClientRect();
    const d = sumar(a, Math.floor((e.clientX - r.left) / dpx));
    abrirForm(null, siguienteLab(d));
  });
}
const ARR = { el: null, x: 0, s: 0, movido: false };

// Tareas con aviso que aún no han terminado, por orden de fecha
function avisosPendientes() {
  return visibles().filter(t => E.avisos.has(t.id) && (t.fin >= HOY || E.avisos.get(t.id).retraso)).sort((a, b) => a.inicio.localeCompare(b.inicio));
}
let avisoIdx = -1;
function siguienteAviso() {
  const l = avisosPendientes(); if (!l.length) return;
  avisoIdx = (avisoIdx + 1) % l.length;
  const t = l[avisoIdx];
  const nodo = [...document.querySelectorAll('.tl-tarea')].find(n => n.dataset.id === t.id);
  if (!nodo) return;
  nodo.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  nodo.classList.remove('resaltar'); void nodo.offsetWidth; nodo.classList.add('resaltar');
  toast(`${t.proyecto}: ${lineasAviso(E.avisos.get(t.id), t)[0]}`);
}

// El diagrama ocupa el alto disponible de la pantalla y se desplaza por dentro,
// así la fila de meses y días queda siempre fija arriba.
function ajustarAlto(el) {
  const arriba = el.getBoundingClientRect().top + window.scrollY;
  const reserva = 120; // barra deslizante y botón «Nueva tarea»
  el.style.maxHeight = Math.max(280, window.innerHeight - arriba - reserva) + 'px';
}
window.addEventListener('resize', () => { const el = $('#tl'); if (el) ajustarAlto(el); });
window.addEventListener('pointermove', e => {
  if (!ARR.el) return;
  const dx = e.clientX - ARR.x;
  if (!ARR.movido && Math.abs(dx) > 5) { ARR.movido = true; ARR.el.classList.add('arrastrando'); }
  if (ARR.movido) ARR.el.scrollLeft = ARR.s - dx;
});
window.addEventListener('pointerup', () => { if (ARR.el) ARR.el.classList.remove('arrastrando'); ARR.el = null; });

/* ---------- Mover y alargar tareas con el ratón ---------- */
const BAR = { nodo: null };

// Días laborables entre dos fechas (ambas incluidas)
function contarLab(a, b) { let n = 0; for (let d = a; d <= b; d = sumar(d, 1)) if (laborable(d)) n++; return n; }

// Cómo quedaría la tarea al desplazarla n días
function previa(t, modo, n) {
  if (modo === 'mover') {
    // Si cae en fin de semana o festivo, salta al laborable más cercano en el sentido del arrastre
    let inicio = sumar(t.inicio, n);
    for (let i = 0; i < 30 && !laborable(inicio); i++) inicio = sumar(inicio, n < 0 ? -1 : 1);
    const r = calcularFin(inicio, t.duracion);
    return { inicio, duracion: t.duracion, fin: r ? r.fin : t.fin };
  }
  let finNuevo = sumar(t.fin, n);
  if (finNuevo < t.inicio) finNuevo = t.inicio;
  const duracion = Math.max(1, contarLab(t.inicio, finNuevo));
  const r = calcularFin(t.inicio, duracion);
  return { inicio: t.inicio, duracion, fin: r ? r.fin : t.fin };
}

window.addEventListener('pointermove', e => {
  if (!BAR.nodo) return;
  const dx = e.clientX - BAR.x;
  if (!BAR.movido && Math.abs(dx) > 4) {
    BAR.movido = true; BAR.nodo.classList.add('moviendo'); BAR.el.classList.add('arrastrando-tarea');
  }
  if (!BAR.movido) return;
  let n = Math.round(dx / BAR.dpx);
  if (BAR.modo === 'alargar') n = Math.max(n, -(entre(BAR.t.inicio, BAR.t.fin)));
  if (n === BAR.n) return;
  BAR.n = n;
  if (BAR.modo === 'mover') BAR.nodo.style.left = (BAR.left + n * BAR.dpx) + 'px';
  else {
    const w = Math.max(BAR.dpx, BAR.w + n * BAR.dpx);
    BAR.fondo.style.width = w + 'px'; BAR.tirador.style.left = w + 'px';
  }
  const p = previa(BAR.t, BAR.modo, n);
  BAR.nodo.querySelector('.s').textContent = `${dm(p.inicio)} – ${dm(p.fin)}, ${plural(p.duracion, 'día', 'días')}`;
});

window.addEventListener('pointerup', () => {
  if (!BAR.nodo) return;
  const { t, modo, n, movido, el } = BAR;
  el.classList.remove('arrastrando-tarea');
  BAR.nodo = null;
  if (!movido) return;           // ha sido un clic: se abre la tarea
  ARR.movido = true;             // evita que el clic abra el formulario
  const p = previa(t, modo, n);
  if (p.inicio === t.inicio && p.duracion === t.duracion) { render(); return; }
  cambiarFechas(t.id, p, true, modo === 'mover' ? 'Movida en el Gantt' : 'Duración cambiada en el Gantt');
});

async function cambiarFechas(id, p, conDeshacer, accion, silencioso) {
  const t = E.tareas.find(x => x.id === id); if (!t) return false;
  const antes = { inicio: t.inicio, duracion: t.duracion, fin: t.fin };
  Object.assign(t, p);
  render();
  try {
    const d = await llamar('guardarTarea', Object.assign({}, t, { accion: accion || 'Modificada' }));
    aplicar(d);
    const nueva = E.tareas.find(x => x.id === id);
    if (dlg.open && E.editId === id) abrirForm(nueva);
    if (!silencioso) {
      const av = E.avisos.get(id);
      const msg = `${t.proyecto}: ${corto(p.inicio)} a ${corto(p.fin)}` + (av ? `. Aviso: ${lineasAviso(av, nueva)[0]}` : '');
      toast(msg, conDeshacer ? { texto: 'Deshacer', fn: () => cambiarFechas(id, antes, false, 'Cambio deshecho') } : null);
      if (nueva && nueva.tipo === 'Fabricación') revisarInstalaciones(id);
    }
    return true;
  } catch (ex) {
    Object.assign(t, antes); render();
    toast('No se pudo guardar el cambio: ' + ((ex && ex.message) || ex));
    return false;
  }
}

// Cambia solo el estado de una tarea (por ejemplo, «Terminar» desde la vista Semana)
async function cambiarEstado(id, estado, conDeshacer) {
  const t = E.tareas.find(x => x.id === id); if (!t) return;
  const antes = t.estado;
  if (antes === estado) return;
  t.estado = estado;
  render();
  try {
    aplicar(await llamar('guardarTarea', Object.assign({}, t, {
      accion: estado === 'Terminada' ? 'Marcada como terminada' : 'Estado cambiado'
    })));
    toast(`${t.proyecto}: ${estado === 'Terminada' ? 'terminada' : 'ahora ' + estado.toLowerCase()}`,
      conDeshacer ? { texto: 'Deshacer', fn: () => cambiarEstado(id, antes, false) } : null);
  } catch (ex) {
    t.estado = antes; render();
    toast('No se pudo guardar: ' + ((ex && ex.message) || ex));
  }
}

// Si una fabricación acaba después de que empiece su instalación, propone moverla
async function revisarInstalaciones(fabId) {
  const fab = E.tareas.find(x => x.id === fabId); if (!fab) return;
  const malas = instalacionesDe(fabId).filter(t => t.estado !== 'Terminada' && t.inicio <= fab.fin);
  if (!malas.length) return;
  const nuevo = siguienteLab(sumar(fab.fin, 1));
  const varias = malas.length > 1;
  const ok = await confirmar(
    varias ? '¿Mover también las instalaciones?' : '¿Mover también la instalación?',
    `La fabricación de ${fab.proyecto} acaba ahora el ${largo(fab.fin).toLowerCase()}, pero ${
      varias ? 'estas instalaciones empiezan' : 'su instalación empieza'} antes: ${
      malas.map(t => `${t.proyecto} (${dm(t.inicio)})`).join(', ')}. ¿${varias ? 'Las muevo' : 'La muevo'} al ${largo(nuevo).toLowerCase()}, manteniendo sus días de trabajo?`,
    varias ? 'Mover instalaciones' : 'Mover instalación', 'Dejar como está');
  if (!ok) return;
  let movidas = 0;
  for (const t of malas) {
    const r = calcularFin(nuevo, t.duracion);
    if (await cambiarFechas(t.id, { inicio: nuevo, duracion: t.duracion, fin: r ? r.fin : nuevo }, false, 'Movida tras su fabricación', true)) movidas++;
  }
  if (movidas) toast(`${plural(movidas, 'instalación movida', 'instalaciones movidas')} al ${corto(nuevo)}`);
}

// Ventana de confirmación con dos botones
function confirmar(titulo, texto, si, no) {
  const d = $('#dlgConf');
  $('#confTit').textContent = titulo; $('#confTxt').textContent = texto;
  $('#confSi').textContent = si; $('#confNo').textContent = no;
  return new Promise(res => {
    const fin = v => { d.close(); $('#confSi').onclick = $('#confNo').onclick = null; res(v); };
    $('#confSi').onclick = () => fin(true);
    $('#confNo').onclick = () => fin(false);
    d.oncancel = e => { e.preventDefault(); fin(false); };
    d.showModal();
    $('#confSi').focus();
  });
}

function irA(fecha, alinear) {
  const el = $('#tl'); if (!el) return;
  const izq = el.querySelector('.tl-esq').offsetWidth, ancho = el.clientWidth - izq;
  const x = (entre(E.tl.a, fecha) + (alinear === 'mes' ? 2 : 0)) * E.tl.dpx - ancho * 0.25;
  el.scrollTo({ left: x, behavior: 'smooth' });
}

function htmlLista() {
  const q = E.busqueda.trim().toLowerCase();
  const ts = visibles()
    .filter(t => E.verTerminadas || t.estado !== 'Terminada')
    .filter(t => !q || [t.proyecto, t.ubicacion, t.equipo, t.observaciones].join(' ').toLowerCase().includes(q))
    .sort((a, b) => a.inicio.localeCompare(b.inicio) || a.proyecto.localeCompare(b.proyecto, 'es'));
  if (!ts.length) {
    return `<div class="vacio">${q || E.filtro.size < 3
      ? 'Ninguna tarea coincide con la búsqueda o los tipos marcados.'
      : 'No hay tareas pendientes. Pulsa «Nueva tarea» para planificar la primera.'}</div>`;
  }
  let h = '', grupo = '';
  ts.forEach(t => {
    const g = t.inicio.slice(0, 7);
    if (g !== grupo) {
      if (grupo) h += '</div>';
      grupo = g;
      h += `<h2 class="grupo">${MESES[+g.slice(5) - 1]} ${g.slice(0, 4)}</h2><div class="tareas">`;
    }
    h += tarjeta(t);
  });
  return h + '</div>';
}

function tarjeta(t) {
  const maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(t.ubicacion);
  const av = E.avisos.get(t.id), fab = fabDe(t);
  const ce = { 'En curso': 'e-cur', 'Terminada': 'e-ter' }[t.estado];
  return `<article class="tarea t-${CLASE[t.tipo]}${t.estado === 'Terminada' ? ' terminada' : ''}" data-id="${esc(t.id)}" tabindex="0" aria-label="Editar ${esc(t.tipo)}: ${esc(t.proyecto)}">
    <span class="tipo">${t.tipo}${ce ? `<em class="estado-t ${ce}">${t.estado}</em>` : ''}</span>
    <span class="proy">${esc(t.proyecto)}</span>
    <span class="fechas">${corto(t.inicio)} a ${corto(t.fin)}, ${plural(t.duracion, 'día laborable', 'días laborables')}</span>
    ${t.ubicacion ? `<span class="dato"><b>Ubicación:</b> <a href="${maps}" target="_blank" rel="noopener">${esc(t.ubicacion)}</a></span>` : ''}
    ${t.equipo ? `<span class="dato"><b>Equipo:</b> ${esc(t.equipo)}</span>` : ''}
    ${(() => { const fs = facturasDe(t.id); return fs.length ? `<span class="dato"><b>Facturas:</b> ${fs.map(f => `${dm(f.fecha)} ${eur(f.importe)}`).join(', ')}</span>` : ''; })()}
    ${E.plan.porFab.has(t.id) && E.plan.porFab.get(t.id).estado !== 'tarde' ? `<span class="dato"><b>Materiales:</b> ${esc(textoMat(E.plan.porFab.get(t.id)))}</span>` : ''}
    ${fab ? `<span class="dato">${ICO.enlace}<b>Después de:</b> ${esc(fab.proyecto)} (acaba el ${dm(fab.fin)})</span>` : ''}
    ${av ? lineasAviso(av, t).map(x => `<span class="aviso-t">${ICO.aviso}${esc(x)}</span>`).join('') : ''}
    ${t.observaciones ? `<span class="obs">${esc(t.observaciones)}</span>` : ''}
  </article>`;
}

/* ---------- Formulario ---------- */
const dlg = $('#dlg'), form = $('#form');
let confirmarBorrado = false;

function tipoElegido() { const r = form.querySelector('input[name=tipo]:checked'); return r ? r.value : ''; }
function estadoElegido() { const r = form.querySelector('input[name=estado]:checked'); return r ? r.value : 'Pendiente'; }
let depAuto = false, guardarIgualmente = false;

function datosForm() {
  const tipo = tipoElegido();
  return {
    id: E.editId, tipo,
    proyecto: $('#fProyecto').value.trim(),
    inicio: $('#fInicio').value,
    duracion: parseInt($('#fDuracion').value, 10),
    ubicacion: $('#fUbicacion').value.trim(),
    equipo: $('#fEquipo').value.trim(),
    observaciones: $('#fObs').value.trim(),
    estado: estadoElegido(),
    facturas: tipo === 'Fabricación' ? [] : leerFilasFact(),
    materiales: tipo === 'Fabricación' ? leerFilasMat() : [],
    dependeDe: tipo === 'Instalación' ? $('#fDepende').value : ''
  };
}

function rellenarFabricaciones(sel) {
  const fabs = E.tareas.filter(t => t.tipo === 'Fabricación').sort((a, b) => b.inicio.localeCompare(a.inicio));
  $('#fDepende').innerHTML = '<option value="">Ninguna</option>' +
    fabs.map(f => `<option value="${esc(f.id)}">${esc(f.proyecto)} (${dm(f.inicio)} – ${dm(f.fin)})</option>`).join('');
  $('#fDepende').value = sel && fabs.some(f => f.id === sel) ? sel : '';
}

// Avisos del formulario: equipo ocupado y fabricación previa
function actualizarAvisosForm() {
  const d = datosForm();
  $('#campoDep').hidden = d.tipo !== 'Instalación';
  $('#campoFact').hidden = !d.tipo || d.tipo === 'Fabricación';
  $('#campoMat').hidden = d.tipo !== 'Fabricación';
  estadoMatForm();
  if (d.tipo === 'Instalación' && depAuto && !$('#fDepende').value && d.proyecto) {
    const f = E.tareas.find(x => x.tipo === 'Fabricación' && normEq(x.proyecto) === normEq(d.proyecto));
    if (f) { $('#fDepende').value = f.id; d.dependeDe = f.id; }
  }
  const r = d.inicio && d.duracion >= 1 ? calcularFin(d.inicio, d.duracion) : null;
  const prov = Object.assign({}, d, { fin: r ? r.fin : d.inicio, id: d.id || '__nueva__' });
  let hay = false;

  const ch = r ? choquesDe(prov) : [];
  const ae = $('#avisoEquipo');
  ae.hidden = !ch.length;
  if (ch.length) {
    hay = true;
    ae.innerHTML = `${ICO.aviso}<b>${esc(d.equipo)}</b> ya tiene otra tarea esos días:<ul>${
      ch.map(o => `<li>${esc(o.proyecto)} (${o.tipo.toLowerCase()}), ${dm(o.inicio)} – ${dm(o.fin)}</li>`).join('')}</ul>`;
  }

  const ad = $('#ayudaDep'), f = fabDe(prov);
  ad.hidden = !f || d.tipo !== 'Instalación';
  ad.classList.remove('mal');
  if (f && d.tipo === 'Instalación') {
    if (r && prov.inicio <= f.fin && d.estado !== 'Terminada') {
      hay = true;
      const sig = siguienteLab(sumar(f.fin, 1));
      ad.classList.add('mal');
      ad.innerHTML = `${ICO.aviso}La fabricación acaba el ${largo(f.fin).toLowerCase()} y esta instalación empieza antes.
        <br><button type="button" data-mover="${sig}">Empezar el ${dm(sig)}</button>`;
    } else {
      ad.innerHTML = `La fabricación acaba el ${largo(f.fin).toLowerCase()}.`;
    }
  }
  E.formAvisos = hay;
}

function pintarHistorial(id) {
  const l = id ? E.historial.filter(x => x.id === id).slice(0, 8) : [];
  $('#histTarea').hidden = !l.length;
  $('#histLista').innerHTML = l.map(x => `<li><b>${fechaHora(x.fecha)}</b>, ${esc(nombreUsuario(x.usuario))}: ${esc(x.accion)}${
    x.detalle ? `<span>${esc(x.detalle)}</span>` : ''}</li>`).join('');
}

function abrirForm(t, inicio) {
  E.editId = t ? t.id : null;
  confirmarBorrado = false;
  $('#titForm').textContent = t ? 'Editar tarea' : 'Nueva tarea';
  const tipoDef = t ? t.tipo : (E.filtro.size === 1 ? [...E.filtro][0] : 'Fabricación');
  form.querySelectorAll('input[name=tipo]').forEach(r => r.checked = r.value === tipoDef);
  $('#fProyecto').value = t ? t.proyecto : '';
  $('#fInicio').value = t ? t.inicio : (inicio || (laborable(HOY) ? HOY : siguienteLab(HOY)));
  $('#fDuracion').value = t ? t.duracion : 1;
  $('#fUbicacion').value = t ? t.ubicacion : '';
  $('#fEquipo').value = t ? t.equipo : '';
  $('#fObs').value = t ? t.observaciones : '';
  form.querySelectorAll('input[name=estado]').forEach(r => r.checked = r.value === (t ? t.estado : 'Pendiente'));
  rellenarFabricaciones(t ? t.dependeDe : '');
  depAuto = !t;
  guardarIgualmente = false;
  $('#btnGuardar').textContent = 'Guardar tarea';
  pintarHistorial(t ? t.id : null);
  pintarFilasFact(t ? facturasDe(t.id) : []);
  pintarFilasMat(t ? bomDe(t.id) : []);
  rellenarCopiarMat(t ? t.id : null);
  setTimeout(actualizarAvisosForm, 0);
  $('#btnEliminar').hidden = !t;
  $('#btnEliminar').textContent = 'Eliminar tarea';
  $('#formError').hidden = true;
  actualizarFin();
  if (escritorio()) {
    dlg.classList.add('lateral');
    marcarSel(t ? t.id : null);
    document.body.classList.add('panel');
    if (!dlg.open) dlg.show();
  } else {
    dlg.classList.remove('lateral');
    if (!dlg.open) dlg.showModal();
  }
  if (!t) setTimeout(() => $('#fProyecto').focus(), 50);
}

function actualizarFin() {
  const ini = $('#fInicio').value;
  const dur = parseInt($('#fDuracion').value, 10);
  const box = $('#finBox'), aviso = $('#avisoInicio');
  box.className = 'fin' + (tipoElegido() ? ' t-' + CLASE[tipoElegido()] : '');
  aviso.hidden = true;
  if (!ini || !(dur >= 1)) { box.innerHTML = '<small>Fecha de fin</small><strong>Indica el inicio y la duración</strong>'; return; }
  if (!laborable(ini)) {
    const sig = siguienteLab(ini);
    const fest = E.festivos.get(ini);
    const motivo = fest ? 'festivo: ' + fest.descripcion : 'fin de semana';
    aviso.innerHTML = `El ${largo(ini).toLowerCase()} no es laborable (${esc(motivo)}). La tarea empieza a contar el ${largo(sig).toLowerCase()}.
      <br><button type="button" data-mover="${sig}">Empezar ese día</button>`;
    aviso.hidden = false;
  }
  const r = calcularFin(ini, dur);
  if (!r) { box.innerHTML = '<small>Fecha de fin</small><strong>Duración demasiado larga</strong>'; return; }
  const saltos = [];
  if (r.finde) saltos.push(plural(r.finde, 'día de fin de semana', 'días de fin de semana'));
  if (r.festivos) saltos.push(plural(r.festivos, 'festivo', 'festivos'));
  box.innerHTML = `<small>Fecha de fin</small><strong>${largo(r.fin)}</strong>
    ${saltos.length ? `<small>Se saltan ${saltos.join(' y ')}</small>` : ''}`;
}

function filaFactHTML(f) {
  return `<div class="fila-fact">
    <input type="date" class="ff-fecha" value="${esc(f.fecha || '')}" aria-label="Fecha de la factura">
    <input type="number" class="ff-importe" min="0" step="0.01" inputmode="decimal" placeholder="Importe (€)" value="${f.importe || ''}" aria-label="Importe en euros">
    <input type="text" class="ff-concepto" placeholder="Concepto (opcional), p. ej. 1.er pago" value="${esc(f.concepto || '')}" aria-label="Concepto">
    <button type="button" class="ff-quitar" aria-label="Quitar factura" title="Quitar factura">×</button>
  </div>`;
}
function pintarFilasFact(lista) {
  $('#listaFact').innerHTML = lista.length ? lista.map(filaFactHTML).join('') : '<p class="fact-vacio">Sin facturas.</p>';
  totalFact();
}
function leerFilasFact() {
  return [...document.querySelectorAll('#listaFact .fila-fact')].map(r => ({
    fecha: r.querySelector('.ff-fecha').value,
    importe: parseFloat(String(r.querySelector('.ff-importe').value).replace(',', '.')) || 0,
    concepto: r.querySelector('.ff-concepto').value.trim()
  }));
}
function totalFact() {
  const l = leerFilasFact().filter(f => f.importe > 0);
  $('#totalFact').textContent = l.length ? `Total: ${eur(l.reduce((s, f) => s + f.importe, 0))}` : '';
}
$('#btnAddFact').addEventListener('click', () => {
  const previas = leerFilasFact();
  const r = $('#fInicio').value && parseInt($('#fDuracion').value, 10) >= 1 ? calcularFin($('#fInicio').value, parseInt($('#fDuracion').value, 10)) : null;
  pintarFilasFact([...previas, { fecha: r ? r.fin : HOY, importe: '', concepto: '' }]);
  const filas = document.querySelectorAll('#listaFact .ff-importe');
  filas[filas.length - 1].focus();
});

$('#btnAddMat').addEventListener('click', () => {
  pintarFilasMat([...leerFilasMat(), { producto: '', cantidad: '' }]);
  const f = document.querySelectorAll('#listaMat .fm-prod');
  f[f.length - 1].focus();
});
$('#copiarMat').addEventListener('change', e => {
  const id = e.target.value; if (!id) return;
  const actuales = leerFilasMat().filter(l => l.producto);
  pintarFilasMat([...actuales, ...bomDe(id).map(b => ({ producto: b.producto, cantidad: b.cantidad }))]);
  e.target.value = '';
  alCambiarForm();
  toast('Materiales copiados. Revisa las cantidades.');
});

function alCambiarForm() {
  infoFilasMat();
  totalFact();
  actualizarFin();
  actualizarAvisosForm();
  if (guardarIgualmente) { guardarIgualmente = false; $('#btnGuardar').textContent = 'Guardar tarea'; $('#formError').hidden = true; }
}
$('#fDepende').addEventListener('change', () => { depAuto = false; });
form.addEventListener('input', alCambiarForm);
form.addEventListener('change', alCambiarForm);
form.addEventListener('click', e => {
  const b = e.target.closest('[data-mover]');
  if (b) { $('#fInicio').value = b.dataset.mover; alCambiarForm(); }
  const qm = e.target.closest('.fm-quitar');
  if (qm) { qm.closest('.fila-mat').remove(); pintarFilasMat(leerFilasMat()); alCambiarForm(); }
  const q = e.target.closest('.ff-quitar');
  if (q) { q.closest('.fila-fact').remove(); pintarFilasFact(leerFilasFact()); alCambiarForm(); }
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#formError');
  const datos = datosForm();
  let msg = '';
  if (!datos.tipo) msg = 'Elige el tipo de tarea.';
  else if (!datos.proyecto) msg = 'Escribe el nombre del proyecto.';
  else if (!datos.inicio) msg = 'Elige la fecha de inicio.';
  else if (!(datos.duracion >= 1 && datos.duracion <= 500)) msg = 'La duración debe estar entre 1 y 500 días laborables.';
  if (!msg && datos.materiales.some(l => l.producto && !(l.cantidad > 0))) msg = 'Falta la cantidad de algún material (o quítalo con la ×).';
  if (!msg && datos.facturas.some(f => f.importe > 0 && !f.fecha)) msg = 'Falta la fecha de alguna factura.';
  if (!msg && datos.facturas.some(f => f.fecha && !(f.importe > 0))) msg = 'Falta el importe de alguna factura (o quítala con la ×).';
  if (msg) { err.textContent = msg; err.hidden = false; return; }
  actualizarAvisosForm();
  if (E.formAvisos && !guardarIgualmente) {
    guardarIgualmente = true;
    $('#btnGuardar').textContent = 'Guardar igualmente';
    err.textContent = 'Revisa los avisos en rojo. Si está bien así, pulsa «Guardar igualmente».';
    err.hidden = false;
    return;
  }

  const btn = $('#btnGuardar');
  btn.disabled = true; btn.textContent = 'Guardando…'; err.hidden = true;
  try {
    const d = await llamar('guardarTarea', datos);
    aplicar(d);
    const dIni = laborable(datos.inicio) ? datos.inicio : siguienteLab(datos.inicio);
    E.anio = +dIni.slice(0, 4); E.mes = +dIni.slice(5, 7) - 1;
    E.tlCentro = dIni;
    render();
    dlg.close();
    toast(datos.id ? 'Tarea actualizada' : 'Tarea guardada');
    if (datos.tipo === 'Fabricación' && datos.id) revisarInstalaciones(datos.id);
  } catch (ex) {
    err.textContent = (ex && ex.message) || String(ex); err.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = guardarIgualmente && dlg.open ? 'Guardar igualmente' : 'Guardar tarea';
  }
});

$('#btnEliminar').addEventListener('click', async () => {
  const b = $('#btnEliminar');
  if (!confirmarBorrado) { confirmarBorrado = true; b.textContent = 'Pulsa otra vez para eliminar'; return; }
  b.disabled = true;
  try {
    aplicar(await llamar('eliminarTarea', E.editId));
    dlg.close();
    toast('Tarea eliminada');
  } catch (ex) {
    $('#formError').textContent = (ex && ex.message) || String(ex); $('#formError').hidden = false;
  } finally { b.disabled = false; }
});

$('#btnCancelar').addEventListener('click', () => dlg.close());
$('#btnCerrar').addEventListener('click', () => dlg.close());
const escritorio = () => matchMedia('(min-width: 1024px) and (pointer: fine)').matches;
function marcarSel(id) {
  document.querySelectorAll('.tl-tarea.sel').forEach(n => n.classList.remove('sel'));
  if (id) document.querySelectorAll('.tl-tarea').forEach(n => { if (n.dataset.id === id) n.classList.add('sel'); });
}
dlg.addEventListener('close', () => { document.body.classList.remove('panel'); E.editId = null; marcarSel(null); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && dlg.open && dlg.classList.contains('lateral') && !$('#dlgConf').open) dlg.close(); });

/* ---------- Navegación y eventos ---------- */
function moverMes(n) {
  const d = new Date(Date.UTC(E.anio, E.mes + n, 1));
  if (E.vista === 'mes' && $('#tl')) { irA(aIso(d), 'mes'); return; }
  E.anio = d.getUTCFullYear(); E.mes = d.getUTCMonth();
  render();
}
$('#mesAnt').addEventListener('click', () => moverMes(-1));
$('#mesSig').addEventListener('click', () => moverMes(1));
$('#mesHoy').addEventListener('click', () => {
  if (E.vista === 'mes' && $('#tl')) { irA(HOY); return; }
  E.anio = +HOY.slice(0, 4); E.mes = +HOY.slice(5, 7) - 1; render();
});
$('#btnNueva').addEventListener('click', () => abrirForm(null, null));
$('#buscar').addEventListener('input', e => { E.busqueda = e.target.value; render(); });
$('#verTerminadas').addEventListener('change', e => { E.verTerminadas = e.target.checked; render(); });

document.addEventListener('click', e => {
  const v = e.target.closest('[data-vista]');
  if (v) { E.vista = v.dataset.vista; try { localStorage.setItem('plan-vista', E.vista); } catch (x) {} render(); return; }
  const tp = e.target.closest('[data-tipo]');
  if (tp) { const t = tp.dataset.tipo; E.filtro.has(t) ? E.filtro.delete(t) : E.filtro.add(t); render(); return; }
  if (e.target.closest('#btnAvisos')) { siguienteAviso(); return; }
  const term = e.target.closest('[data-terminar]');
  if (term) { cambiarEstado(term.dataset.terminar, 'Terminada', true); return; }
  const es = e.target.closest('[data-escala]');
  if (es) { ESC = es.dataset.escala; try { localStorage.setItem('plan-escala', ESC); } catch (x) {} render(); return; }
  const nueva = e.target.closest('[data-nueva]');
  if (nueva) { abrirForm(null, siguienteLab(nueva.dataset.nueva)); return; }
  if (e.target.closest('a')) return;
  const card = e.target.closest('[data-id]');
  if (card) { const t = E.tareas.find(x => x.id === card.dataset.id); if (t) abrirForm(t); }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card = e.target.closest && e.target.closest('[data-id]');
  if (card && e.target === card) { e.preventDefault(); const t = E.tareas.find(x => x.id === card.dataset.id); if (t) abrirForm(t); }
});

/* ---------- Actualizar datos ---------- */
let ultimaAct = null;
const fHora = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const fCompleta = new Intl.DateTimeFormat('es-ES', { dateStyle: 'full', timeStyle: 'short' });
function marcarActualizado() { ultimaAct = new Date(); pintarAct(); }
function pintarAct() {
  if (!ultimaAct) return;
  const d = ultimaAct, esHoy = new Date().toDateString() === d.toDateString();
  $('#txtAct').textContent = 'Actualizado ' + (esHoy ? '' : d.getDate() + ' ' + MESES[d.getMonth()].slice(0, 3).toLowerCase() + ', ') + fHora.format(d);
  $('#btnRefrescar').title = 'Datos cargados el ' + fCompleta.format(d) + '. Pulsa para cargar los últimos cambios.';
}
async function refrescar() {
  const b = $('#btnRefrescar');
  if (b.classList.contains('girando')) return;
  b.classList.add('girando');
  $('#txtAct').textContent = 'Actualizando…';
  try {
    aplicar(await llamar('obtenerDatos'));
    toast('Planificación actualizada');
  } catch (ex) {
    pintarAct();
    toast('No se pudo actualizar: ' + ((ex && ex.message) || ex));
  } finally {
    b.classList.remove('girando');
  }
}
$('#btnRefrescar').addEventListener('click', refrescar);

/* ---------- Nuevo proyecto completo ---------- */
const dlgP = $('#dlgProy'), formP = $('#formProy');
let crearIgual = false;
function abrirProyecto() {
  formP.reset();
  $('#pFabInicio').value = laborable(HOY) ? HOY : siguienteLab(HOY);
  $('#pFabDur').value = 5; $('#pInsDur').value = 3; $('#pMargen').value = 0;
  crearIgual = false; $('#pGuardar').textContent = 'Crear proyecto'; $('#pError').hidden = true;
  resumenProy();
  dlgP.showModal();
  setTimeout(() => $('#pProyecto').focus(), 50);
}
function calcProy() {
  const fi = $('#pFabInicio').value, fd = parseInt($('#pFabDur').value, 10), id = parseInt($('#pInsDur').value, 10);
  const m = Math.max(0, parseInt($('#pMargen').value, 10) || 0);
  if (!fi || !(fd >= 1 && fd <= 500) || !(id >= 1 && id <= 500)) return null;
  const fr = calcularFin(fi, fd); if (!fr) return null;
  let ii = siguienteLab(sumar(fr.fin, 1));
  for (let k = 0; k < m; k++) ii = siguienteLab(sumar(ii, 1));
  const ir = calcularFin(ii, id); if (!ir) return null;
  return {
    fab: { id: '__f', tipo: 'Fabricación', inicio: laborable(fi) ? fi : siguienteLab(fi), fin: fr.fin, duracion: fd, equipo: $('#pFabEquipo').value.trim(), estado: 'Pendiente' },
    ins: { id: '__i', tipo: 'Instalación', inicio: ii, fin: ir.fin, duracion: id, equipo: $('#pInsEquipo').value.trim(), estado: 'Pendiente' },
    margen: m
  };
}
function resumenProy() {
  const p = calcProy(), box = $('#pResumen');
  if (!p) { box.innerHTML = ''; E.proyAvisos = false; return; }
  const linea = (t, cl) => `<div class="linea-r t-${cl}"><b>${t.tipo}</b><span>${corto(t.inicio)} a ${corto(t.fin)}, ${plural(t.duracion, 'día laborable', 'días laborables')}</span></div>`;
  const av = [...choquesDe(p.fab).map(o => [p.fab, o]), ...choquesDe(p.ins).map(o => [p.ins, o])];
  box.innerHTML = linea(p.fab, 'fab') + linea(p.ins, 'ins') + (av.length ? `<div class="aviso aviso-rojo">${ICO.aviso}Equipos ocupados:<ul>${
    av.map(([t, o]) => `<li>${esc(t.equipo)} (${t.tipo.toLowerCase()}) ya está en ${esc(o.proyecto)}, ${dm(o.inicio)} – ${dm(o.fin)}</li>`).join('')}</ul></div>` : '');
  E.proyAvisos = av.length > 0;
}
formP.addEventListener('input', () => {
  resumenProy();
  if (crearIgual) { crearIgual = false; $('#pGuardar').textContent = 'Crear proyecto'; $('#pError').hidden = true; }
});
document.querySelectorAll('[data-cerrar-proy]').forEach(b => b.addEventListener('click', () => dlgP.close()));
$('#btnProyecto').addEventListener('click', abrirProyecto);
formP.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#pError'), p = calcProy();
  const proyecto = $('#pProyecto').value.trim();
  let msg = '';
  if (!proyecto) msg = 'Escribe el nombre del proyecto.';
  else if (!p) msg = 'Revisa la fecha de inicio y las duraciones (entre 1 y 500 días).';
  if (msg) { err.textContent = msg; err.hidden = false; return; }
  if (E.proyAvisos && !crearIgual) {
    crearIgual = true; $('#pGuardar').textContent = 'Crear igualmente';
    err.textContent = 'Hay equipos ocupados esos días. Si está bien así, pulsa «Crear igualmente».'; err.hidden = false;
    return;
  }
  const btn = $('#pGuardar');
  btn.disabled = true; btn.textContent = 'Creando…'; err.hidden = true;
  try {
    const d = await llamar('crearProyecto', {
      proyecto, ubicacion: $('#pUbicacion').value.trim(), observaciones: $('#pObs').value.trim(),
      fabInicio: $('#pFabInicio').value, fabDuracion: p.fab.duracion, fabEquipo: p.fab.equipo,
      insDuracion: p.ins.duracion, insEquipo: p.ins.equipo, margen: p.margen
    });
    aplicar(d);
    E.tlCentro = p.fab.inicio; E.anio = +p.fab.inicio.slice(0, 4); E.mes = +p.fab.inicio.slice(5, 7) - 1;
    render();
    dlgP.close();
    toast(`${proyecto}: fabricación e instalación creadas`);
  } catch (ex) {
    err.textContent = (ex && ex.message) || String(ex); err.hidden = false;
  } finally {
    btn.disabled = false; if (dlgP.open) btn.textContent = crearIgual ? 'Crear igualmente' : 'Crear proyecto';
  }
});

/* =====================================================================
   COMPRAS: stock, materiales por proyecto y planificación de pedidos
   ===================================================================== */
const normProd = s => String(s || '').trim().replace(/\s+/g, ' ');
const fNum = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, useGrouping: 'always' });
const num = n => fNum.format(n);
const udCorta = u => ({ 'Unidades': 'ud.', 'unidades': 'ud.' }[u] || u || '');
const bomDe = id => (E.compras.bom || []).filter(b => b.tarea === id);
const stockTotal = m => Object.values((m && m.stock) || {}).reduce((s, x) => s + x, 0);
const nombreCorto = p => String(p).replace(/^\[[^\]]+\]\s*/, '');
const ORDEN_EST = { sin: 0, ok: 1, pedido: 2, pedir: 3, tarde: 4 };

/*
 * Reparte el stock y los pedidos en camino entre las fabricaciones pendientes,
 * por orden de fecha. Lo que falta hay que pedirlo: la fecha límite de pedido es
 * la fecha de fabricación menos el plazo de entrega del proveedor (días naturales).
 * «over» permite simular una tarea con datos del formulario sin guardar.
 */
function planCompras(over) {
  const plan = { porFab: new Map(), aPedir: [] };
  const C = E.compras;
  const pool = new Map();
  (C.materiales || []).forEach(m => pool.set(m.producto, [{ fecha: '', qty: stockTotal(m), tipo: 'stock' }]));
  (C.pedidos || []).filter(p => p.estado === 'Pendiente').forEach(p => {
    if (!pool.has(p.producto)) pool.set(p.producto, []);
    pool.get(p.producto).push({ fecha: p.llegada, qty: p.cantidad, tipo: 'pedido', pedido: p });
  });
  pool.forEach(l => l.sort((a, b) => a.fecha.localeCompare(b.fecha)));

  let tareas = E.tareas.slice();
  if (over) {
    const i = tareas.findIndex(t => t.id === over.id);
    if (i >= 0) tareas[i] = over; else tareas.push(over);
  }
  const fabs = tareas.filter(t => t.tipo === 'Fabricación' && t.estado === 'Pendiente')
    .sort((a, b) => a.inicio.localeCompare(b.inicio) || a.proyecto.localeCompare(b.proyecto, 'es'));

  fabs.forEach(f => {
    const lineas = over && f.id === over.id ? over.bom : bomDe(f.id);
    if (!lineas.length) return;
    const D = f.inicio < HOY ? HOY : f.inicio;
    const res = { fab: f, D, lineas: [], estado: 'ok' };
    lineas.forEach(l => {
      const k = normProd(l.producto), m = E.matMap.get(k);
      const r = { producto: k, mat: m, cantidad: l.cantidad, deStock: 0, aTiempo: [], tarde: [], aPedir: 0, fab: f, D };
      let falta = l.cantidad;
      for (const it of (pool.get(k) || [])) {
        if (falta <= 1e-9) break;
        if (it.qty <= 1e-9) continue;
        const u = Math.min(it.qty, falta);
        it.qty -= u; falta -= u;
        if (it.tipo === 'stock') r.deStock += u;
        else (it.fecha <= D ? r.aTiempo : r.tarde).push({ qty: u, llegada: it.fecha });
      }
      r.aPedir = Math.round(falta * 1000) / 1000;
      if (r.aPedir > 0) {
        const plazo = m ? m.plazo : 0;
        r.limite = sumar(D, -plazo);
        r.fueraPlazo = r.limite < HOY;
        r.llegada = r.fueraPlazo ? sumar(HOY, plazo) : D;
        plan.aPedir.push(r);
      }
      r.estado = r.fueraPlazo || r.tarde.length ? 'tarde' : r.aPedir > 0 ? 'pedir' : r.aTiempo.length ? 'pedido' : 'ok';
      if (ORDEN_EST[r.estado] > ORDEN_EST[res.estado]) res.estado = r.estado;
      res.lineas.push(r);
    });
    plan.porFab.set(f.id, res);
  });
  return plan;
}

// Texto corto del estado de materiales de una fabricación
function textoMat(pm) {
  if (!pm) return '';
  const pedir = pm.lineas.filter(l => l.aPedir > 0);
  const tarde = pm.lineas.filter(l => l.estado === 'tarde');
  if (pm.estado === 'ok') return 'Todo el material está en stock';
  if (pm.estado === 'pedido') return 'Cubierto con pedidos que llegan a tiempo';
  if (pm.estado === 'pedir') {
    const lim = pedir.reduce((m, l) => (l.limite < m ? l.limite : m), pedir[0].limite);
    return `${pedir.length === 1 ? 'Falta 1 material' : `Faltan ${pedir.length} materiales`}: hay que pedir antes del ${dm(lim)}`;
  }
  const peor = tarde.reduce((m, l) => {
    const ll = l.fueraPlazo ? l.llegada : l.tarde.reduce((x, t) => (t.llegada > x ? t.llegada : x), '');
    return ll > m ? ll : m;
  }, '');
  return `${plural(tarde.length, 'material no llega', 'materiales no llegan')} a tiempo (llegaría el ${dm(peor)})`;
}

/* ---------- Materiales en el formulario de fabricación ---------- */
function filaMatHTML(l) {
  return `<div class="fila-mat">
    <input type="text" class="fm-prod" list="dlMateriales" placeholder="Busca por código o nombre" value="${esc(l.producto || '')}" aria-label="Material">
    <input type="number" class="fm-cant" min="0" step="any" inputmode="decimal" placeholder="Cant." value="${l.cantidad || ''}" aria-label="Cantidad">
    <span class="fm-ud"></span>
    <button type="button" class="fm-quitar" aria-label="Quitar material" title="Quitar material">×</button>
    <small class="fm-info"></small>
  </div>`;
}
function pintarFilasMat(lista) {
  $('#listaMat').innerHTML = lista.length ? lista.map(filaMatHTML).join('') : '<p class="fact-vacio">Sin materiales.</p>';
  infoFilasMat();
}
function leerFilasMat() {
  return [...document.querySelectorAll('#listaMat .fila-mat')].map(r => ({
    producto: normProd(r.querySelector('.fm-prod').value),
    cantidad: parseFloat(String(r.querySelector('.fm-cant').value).replace(',', '.')) || 0
  }));
}
function infoFilasMat() {
  document.querySelectorAll('#listaMat .fila-mat').forEach(r => {
    const p = normProd(r.querySelector('.fm-prod').value), m = E.matMap.get(p);
    r.querySelector('.fm-ud').textContent = m ? udCorta(m.unidad) : '';
    const info = r.querySelector('.fm-info');
    info.classList.toggle('mal', !!p && !m);
    if (!p) { info.textContent = ''; return; }
    if (!m) { info.textContent = 'No está en el catálogo: añádelo en la pestaña «Catálogo» de la hoja para saber su proveedor y plazo.'; return; }
    const ubs = Object.entries(m.stock).map(([u, q]) => `${u} ${num(q)}`).join(', ');
    info.textContent = `Stock: ${num(stockTotal(m))} ${udCorta(m.unidad)}${ubs ? ` (${ubs})` : ''}. ${m.proveedor || 'Sin proveedor'}, ${plural(m.plazo, 'día', 'días')} de entrega.`;
  });
}
function rellenarCopiarMat(idActual) {
  const ids = [...new Set((E.compras.bom || []).map(b => b.tarea))].filter(id => id !== idActual);
  const fabs = ids.map(id => E.tareas.find(t => t.id === id)).filter(Boolean).sort((a, b) => b.inicio.localeCompare(a.inicio));
  $('#copiarMat').innerHTML = '<option value="">Copiar materiales de…</option>' +
    fabs.map(f => `<option value="${esc(f.id)}">${esc(f.proyecto)} (${dm(f.inicio)})</option>`).join('');
  $('#copiarMat').hidden = !fabs.length;
}
// Estado de materiales con los datos del formulario, antes de guardar
function estadoMatForm() {
  const box = $('#estadoMat');
  const d = datosForm();
  if (d.tipo !== 'Fabricación') { box.hidden = true; return; }
  const lineas = d.materiales.filter(l => l.producto && l.cantidad > 0);
  box.hidden = !lineas.length;
  if (!lineas.length) return;
  box.className = 'nota-campo';
  if (d.estado !== 'Pendiente') { box.textContent = 'La disponibilidad de material solo se calcula para fabricaciones pendientes.'; return; }
  if (!d.inicio) { box.textContent = ''; return; }
  const over = Object.assign({}, d, { id: d.id || '__nueva__', bom: lineas });
  const pm = planCompras(over).porFab.get(over.id);
  if (!pm) { box.textContent = ''; return; }
  const cls = { ok: 'bien', pedido: 'bien', pedir: 'atento', tarde: 'mal' }[pm.estado];
  box.className = 'nota-campo ' + cls;
  const det = pm.lineas.filter(l => l.aPedir > 0 || l.tarde.length).map(l => {
    const m = l.mat || {};
    if (l.tarde.length && !l.aPedir) return `<li>${esc(nombreCorto(l.producto))}: el pedido en camino llega el ${dm(l.tarde[0].llegada)}, tarde.</li>`;
    return `<li>${esc(nombreCorto(l.producto))}: faltan ${num(l.aPedir)} ${udCorta(m.unidad)}. ${l.fueraPlazo
      ? `Pidiéndolo hoy a ${esc(m.proveedor || 'su proveedor')} llegaría el ${dm(l.llegada)}.`
      : `Pedir a ${esc(m.proveedor || 'su proveedor')} antes del ${dm(l.limite)}.`}</li>`;
  }).join('');
  box.innerHTML = `${pm.estado === 'tarde' ? ICO.aviso : ''}<b>${textoMat(pm)}.</b>${det ? `<ul>${det}</ul>` : ''}`;
}

/* ---------- Vista Compras ---------- */
function gruposPedir() {
  const g = new Map();
  E.plan.aPedir.forEach(r => {
    const prov = (r.mat && r.mat.proveedor) || 'Sin proveedor';
    if (!g.has(prov)) g.set(prov, { proveedor: prov, plazo: r.mat ? r.mat.plazo : 0, limite: r.limite, fueraPlazo: false, prods: new Map() });
    const G = g.get(prov);
    if (r.limite < G.limite) G.limite = r.limite;
    if (r.fueraPlazo) G.fueraPlazo = true;
    if (!G.prods.has(r.producto)) G.prods.set(r.producto, { producto: r.producto, mat: r.mat, cantidad: 0, para: [], limite: r.limite, fueraPlazo: false, llegada: r.llegada });
    const P = G.prods.get(r.producto);
    P.cantidad = Math.round((P.cantidad + r.aPedir) * 1000) / 1000;
    P.para.push({ proyecto: r.fab.proyecto, D: r.D, qty: r.aPedir });
    if (r.limite < P.limite) P.limite = r.limite;
    if (r.fueraPlazo) { P.fueraPlazo = true; if (r.llegada > P.llegada) P.llegada = r.llegada; }
  });
  return [...g.values()].sort((a, b) => a.limite.localeCompare(b.limite));
}
function urgencia(lim) {
  if (lim < HOY) return ['fuera', 'Fuera de plazo'];
  if (lim === HOY) return ['hoy', 'Pedir hoy'];
  if (lim <= sumar(HOY, 7)) return ['semana', `Pedir esta semana, antes del ${dm(lim)}`];
  return ['luego', `Pedir antes del ${dm(lim)}`];
}

let LINEAS_PEDIR = [];
function htmlCompras() {
  const C = E.compras;
  if (C.error) return `<div class="vacio">No se pudo leer el inventario: ${esc(C.error)}</div>`;
  if (!C.materiales.length) {
    return `<div class="vacio"><b>Aún no hay inventario.</b> Abre la hoja de cálculo, ve a la pestaña «Inventario» e importa ahí el Excel de stock
      (Archivo › Importar › Subir › «Reemplazar hoja actual»). Después pulsa el botón de actualizar de la app.</div>`;
  }
  const grupos = gruposPedir();
  const camino = (C.pedidos || []).filter(p => p.estado === 'Pendiente');
  const sinMat = E.tareas.filter(t => t.tipo === 'Fabricación' && t.estado === 'Pendiente' && t.fin >= HOY && !bomDe(t.id).length);
  const tabs = [
    ['pedir', 'Por pedir', grupos.reduce((s, g) => s + g.prods.size, 0)],
    ['calendario', 'Calendario', null],
    ['camino', 'En camino', camino.length],
    ['stock', 'Stock', null]
  ];
  const sub = E.subCompras || 'pedir';
  let h = `<div class="sub-tabs" role="tablist">${tabs.map(([k, n, c]) =>
    `<button type="button" role="tab" data-sub="${k}" aria-selected="${k === sub}">${n}${c ? ` <span class="cuenta">${c}</span>` : ''}</button>`).join('')}</div>`;
  if (sinMat.length && sub !== 'stock') {
    h += `<p class="nota">${ICO.aviso}${plural(sinMat.length, 'fabricación pendiente no tiene', 'fabricaciones pendientes no tienen')} materiales asignados y no se tienen en cuenta:
      ${sinMat.slice(0, 6).map(t => `<button type="button" class="enlace" data-abrir="${esc(t.id)}">${esc(t.proyecto)}</button>`).join(', ')}${sinMat.length > 6 ? '…' : ''}.</p>`;
  }
  if (sub === 'pedir') h += htmlPorPedir(grupos);
  else if (sub === 'calendario') h += htmlCalCompras(grupos, camino);
  else if (sub === 'camino') h += htmlEnCamino(camino);
  else h += htmlStock();
  return h;
}

function htmlPorPedir(grupos) {
  LINEAS_PEDIR = [];
  if (!grupos.length) return `<div class="vacio">${ICO.check} No hace falta pedir nada: el stock y los pedidos en camino cubren todas las fabricaciones pendientes que tienen materiales.</div>`;
  return grupos.map(G => {
    const [cls, txt] = urgencia(G.limite);
    const filas = [...G.prods.values()].sort((a, b) => a.limite.localeCompare(b.limite)).map(P => {
      const i = LINEAS_PEDIR.push({ producto: P.producto, cantidad: P.cantidad, proveedor: G.proveedor, plazo: G.plazo,
        para: P.para.map(x => `${x.proyecto} (${num(x.qty)})`).join(', ') }) - 1;
      const m = P.mat || {};
      return `<label class="linea-pedir${P.fueraPlazo ? ' fuera' : ''}">
        <input type="checkbox" data-linea="${i}" checked>
        <span class="lp-mat"><b>${esc(nombreCorto(P.producto))}</b>${m.codigo ? ` <small>${esc(m.codigo)}</small>` : ''}</span>
        <span class="lp-cant">${num(P.cantidad)} ${udCorta(m.unidad)}</span>
        <span class="lp-para">Para ${P.para.map(x => `${esc(x.proyecto)} (fab. ${dm(x.D)})`).join(', ')}</span>
        <span class="lp-lim">${P.fueraPlazo ? `${ICO.aviso}Pidiéndolo hoy llegaría el ${dm(P.llegada)}` : `Pedir antes del ${dm(P.limite)}`}</span>
      </label>`;
    }).join('');
    return `<section class="prov-card urg-${cls}">
      <header><div><h3>${esc(G.proveedor)}</h3><small>Plazo de entrega: ${plural(G.plazo, 'día', 'días')}</small></div><span class="urg">${txt}</span></header>
      <div class="lineas">${filas}</div>
      <div class="prov-acc"><button type="button" class="primario" data-pedir-prov="${esc(G.proveedor)}">Marcar como pedido</button>
        <small>Se anota en la pestaña «Pedidos» con la llegada prevista según el plazo.</small></div>
    </section>`;
  }).join('');
}

function htmlEnCamino(camino) {
  if (!camino.length) return '<div class="vacio">No hay pedidos en camino.</div>';
  const l = camino.slice().sort((a, b) => a.llegada.localeCompare(b.llegada));
  return `<p class="nota">Marca un pedido como «Recibido» cuando ya esté dado de alta en el inventario y hayas vuelto a importar el Excel de stock. Si el proveedor te da otra fecha, cámbiala aquí.</p>
    <div class="camino">${l.map(p => `<div class="pedido-fila${p.llegada < HOY ? ' tarde' : ''}">
      <div class="pf-mat"><b>${esc(nombreCorto(p.producto))}</b><small>${num(p.cantidad)} ${udCorta(p.unidad)} · ${esc(p.proveedor)} · pedido el ${dm(p.fecha)}${p.para ? ` · para ${esc(p.para)}` : ''}</small></div>
      <label class="pf-lleg"><span>${p.llegada < HOY ? `${ICO.aviso}Debía llegar` : 'Llega'}</span><input type="date" value="${p.llegada}" data-llegada="${esc(p.id)}"></label>
      <div class="pf-acc"><button type="button" class="btn-terminar" data-recibido="${esc(p.id)}">${ICO.check}Recibido</button>
        <button type="button" class="secundario" data-anular="${esc(p.id)}">Anular</button></div>
    </div>`).join('')}</div>`;
}

function filasStock() {
  const C = E.compras, q = (E.stockQ || '').toLowerCase();
  const nec = new Map();
  E.tareas.filter(t => t.tipo === 'Fabricación' && t.estado === 'Pendiente').forEach(t =>
    bomDe(t.id).forEach(b => nec.set(b.producto, (nec.get(b.producto) || 0) + b.cantidad)));
  const cam = new Map();
  (C.pedidos || []).filter(p => p.estado === 'Pendiente').forEach(p => cam.set(p.producto, (cam.get(p.producto) || 0) + p.cantidad));
  return C.materiales.filter(m => !q || (m.producto + ' ' + m.proveedor).toLowerCase().includes(q))
    .map(m => ({ m, total: stockTotal(m), nec: nec.get(m.producto) || 0, cam: cam.get(m.producto) || 0 }))
    .filter(x => !E.soloFalta || x.nec > x.total + x.cam)
    .sort((a, b) => a.m.producto.localeCompare(b.m.producto, 'es'))
    .map(x => {
      const falta = x.nec > x.total + x.cam;
      return `<tr class="${falta ? 'falta' : ''}"><td><b>${esc(nombreCorto(x.m.producto))}</b><small>${esc(x.m.codigo || '')}</small></td>
        ${C.ubicaciones.map(u => `<td class="n">${x.m.stock[u] ? num(x.m.stock[u]) : '–'}</td>`).join('')}
        <td class="n"><b>${num(x.total)}</b></td><td class="n">${x.nec ? num(x.nec) : '–'}</td><td class="n">${x.cam ? num(x.cam) : '–'}</td>
        <td>${esc(udCorta(x.m.unidad))}</td><td>${esc(x.m.proveedor)}</td><td class="n">${x.m.plazo} d</td></tr>`;
    }).join('') || `<tr><td colspan="${7 + C.ubicaciones.length}" class="vacio-td">Ningún material coincide.</td></tr>`;
}
function htmlStock() {
  const C = E.compras;
  return `<div class="stock-barra"><input type="search" id="stockBuscar" class="buscar-stock" placeholder="Buscar material o proveedor" value="${esc(E.stockQ || '')}">
    <label class="terminadas"><input type="checkbox" id="soloFalta"${E.soloFalta ? ' checked' : ''}> Solo con falta</label></div>
    <div class="tabla-scroll"><table class="tabla-stock"><thead><tr><th>Material</th>${C.ubicaciones.map(u => `<th class="n">${esc(u)}</th>`).join('')}
      <th class="n">Total</th><th class="n" title="Lo que necesitan las fabricaciones pendientes">Necesario</th><th class="n">En camino</th><th>Ud.</th><th>Proveedor</th><th class="n">Plazo</th></tr></thead>
      <tbody id="stockBody">${filasStock()}</tbody></table></div>
    <p class="nota">El proveedor y el plazo de cada material se cambian en la pestaña «Catálogo» de la hoja de cálculo.</p>`;
}

// Calendario de compras: un carril por proveedor
function htmlCalCompras(grupos, camino) {
  const filas = new Map();
  const fila = prov => { if (!filas.has(prov)) filas.set(prov, { nombre: prov, items: [] }); return filas.get(prov); };
  // Una barra por proveedor y fabricación: de la fecha límite de pedido a la fecha de fabricación
  const porFab = new Map();
  E.plan.aPedir.forEach(r => {
    const prov = (r.mat && r.mat.proveedor) || 'Sin proveedor';
    const k = prov + '|' + r.fab.id;
    if (!porFab.has(k)) porFab.set(k, { prov, fab: r.fab, D: r.D, limite: r.limite, fuera: false, mats: [] });
    const x = porFab.get(k);
    if (r.limite < x.limite) x.limite = r.limite;
    if (r.fueraPlazo) x.fuera = true;
    x.mats.push(`${num(r.aPedir)} ${udCorta(r.mat ? r.mat.unidad : '')} ${nombreCorto(r.producto)}`);
  });
  porFab.forEach(x => fila(x.prov).items.push({
    inicio: x.fuera ? HOY : x.limite, fin: x.D < HOY ? HOY : x.D, cls: x.fuera ? 'c-tarde' : 'c-pedir',
    p: `${x.fuera ? 'Fuera de plazo, pedir ya' : 'Pedir antes del ' + dm(x.limite)}: ${x.fab.proyecto}`,
    s: `${plural(x.mats.length, 'material', 'materiales')}, fabricación el ${dm(x.D)}`,
    tip: [`${x.prov}: pedir antes del ${dm(x.limite)}`, `Para ${x.fab.proyecto} (fabricación el ${dm(x.D)})`, ...x.mats].join('\n')
  }));
  camino.forEach(p => fila(p.proveedor).items.push({
    inicio: p.fecha, fin: p.llegada < p.fecha ? p.fecha : p.llegada, cls: 'c-camino',
    p: `En camino: ${nombreCorto(p.producto)}`, s: `${num(p.cantidad)} ${udCorta(p.unidad)}, llega el ${dm(p.llegada)}`,
    tip: `${p.proveedor}: ${num(p.cantidad)} ${udCorta(p.unidad)} ${p.producto}\nPedido el ${dm(p.fecha)}, llega el ${dm(p.llegada)}`
  }));
  if (!filas.size) return '<div class="vacio">No hay pedidos pendientes ni por hacer.</div>';
  const lista = [...filas.values()].sort((a, b) => {
    const ma = a.items.reduce((m, i) => (i.inicio < m ? i.inicio : m), '9999'), mb = b.items.reduce((m, i) => (i.inicio < m ? i.inicio : m), '9999');
    return ma.localeCompare(mb);
  });
  return `<div class="leyenda-c"><span class="c-pedir"><i></i>Desde la fecha límite de pedido hasta la fabricación</span>
    <span class="c-tarde"><i></i>Fuera de plazo</span><span class="c-camino"><i></i>Pedido en camino</span></div>` + htmlCrono('tlc', lista);
}

// Cronograma sencillo (sin arrastre) con el mismo aspecto que el Gantt
function htmlCrono(id, filas) {
  const dpx = 12;
  let a = sumar(HOY, -14), b = sumar(HOY, 90);
  filas.forEach(f => f.items.forEach(it => { if (it.inicio < a) a = it.inicio; if (it.fin > b) b = it.fin; }));
  a = a.slice(0, 8) + '01'; b = finDeMes(sumar(finDeMes(b), 1));
  const nd = entre(a, b) + 1, W = nd * dpx;
  E.crono = { a, dpx };
  let h = `<div class="tl esc-semanas" id="${id}" style="--dpx:${dpx}px"><div class="tl-lienzo" style="width:calc(var(--izq) + ${W}px)">
    <div class="tl-cab"><div class="tl-esq"></div><div class="tl-escala" style="width:${W}px;cursor:default">`;
  for (let m = a; m <= b; m = sumar(finDeMes(m), 1)) {
    const fm = finDeMes(m) > b ? b : finDeMes(m);
    h += `<div class="tl-mes" style="left:${entre(a, m) * dpx}px;width:${(entre(m, fm) + 1) * dpx}px"><span>${MESES[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}</span></div>`;
  }
  for (let i = 0; i < nd; i++) {
    const d = sumar(a, i);
    if (utc(d).getUTCDay() === 1) h += `<div class="tl-dia lunes" style="left:${i * dpx}px;width:${dpx * 7}px"><b>${+d.slice(8)}</b></div>`;
  }
  if (HOY >= a && HOY <= b) h += `<span class="tl-hoyeti" style="left:${(entre(a, HOY) + .5) * dpx}px">Hoy</span>`;
  h += `</div></div><div class="tl-cuerpo"><div class="tl-fondo" style="width:${W}px">`;
  for (let i = 0; i < nd; i++) { const d = sumar(a, i); if (!laborable(d)) h += `<span class="tl-nolab" style="left:${i * dpx}px;width:${dpx}px"></span>`; }
  for (let m = sumar(finDeMes(a), 1); m <= b; m = sumar(finDeMes(m), 1)) h += `<span class="tl-raya" style="left:${entre(a, m) * dpx}px"></span>`;
  if (HOY >= a && HOY <= b) h += `<span class="tl-hoy" style="left:${(entre(a, HOY) + .5) * dpx - 1}px"></span>`;
  h += '</div>';
  filas.forEach(f => {
    const items = f.items.slice().sort((x, y) => x.inicio.localeCompare(y.inicio));
    const ocup = [];
    const pos = items.map(it => {
      const x = entre(a, it.inicio) * dpx, w = (entre(it.inicio, it.fin) + 1) * dpx;
      const tw = Math.min(380, Math.max(it.p.length * 7.6, it.s.length * 6.3) + 24);
      let r = ocup.findIndex(fin => fin + 8 <= x);
      if (r < 0) { r = ocup.length; ocup.push(0); }
      ocup[r] = x + Math.max(w, tw);
      return { it, x, w, r };
    });
    h += `<div class="tl-carril"><div class="tl-nom c-prov"><div class="tl-nom-in"><b>${esc(f.nombre)}</b><small>${plural(items.length, 'entrada', 'entradas')}</small></div></div>
      <div class="tl-zona" style="width:${W}px;height:${Math.max(1, ocup.length) * 48 + 8}px">`;
    pos.forEach(o => {
      h += `<div class="tl-tarea ${o.it.cls}" style="left:${o.x}px;top:${8 + o.r * 48}px;cursor:default" title="${esc(o.it.tip)}">
        <span class="fondo" style="width:${o.w}px"></span>
        <span class="txt"><span class="p">${esc(o.it.p)}</span><span class="s">${esc(o.it.s)}</span></span></div>`;
    });
    h += '</div></div>';
  });
  return h + '</div></div></div>';
}
function initCrono() {
  const el = $('#tlc'); if (!el) return;
  ajustarAlto(el);
  const izq = el.querySelector('.tl-esq').offsetWidth;
  el.scrollLeft = entre(E.crono.a, HOY) * E.crono.dpx - (el.clientWidth - izq) * 0.15;
  el.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    ARR.el = el; ARR.x = e.clientX; ARR.s = el.scrollLeft; ARR.movido = false;
  });
}

/* ---------- Acciones de compras ---------- */
async function pedirProveedor(prov, boton) {
  const marcadas = [...document.querySelectorAll('.prov-card input[data-linea]:checked')]
    .map(c => LINEAS_PEDIR[+c.dataset.linea]).filter(l => l && l.proveedor === prov);
  if (!marcadas.length) { toast('Marca al menos un material para pedir.'); return; }
  boton.disabled = true; boton.textContent = 'Guardando…';
  try {
    aplicar(await llamar('registrarPedido', marcadas));
    toast(`Pedido a ${prov} anotado: ${plural(marcadas.length, 'material', 'materiales')}`);
  } catch (ex) {
    toast('No se pudo guardar el pedido: ' + ((ex && ex.message) || ex));
    boton.disabled = false; boton.textContent = 'Marcar como pedido';
  }
}
async function cambiarPedido(id, cambios, msg) {
  try {
    aplicar(await llamar('actualizarPedido', id, cambios));
    if (msg) toast(msg);
  } catch (ex) {
    toast('No se pudo actualizar el pedido: ' + ((ex && ex.message) || ex));
    render();
  }
}
document.addEventListener('click', e => {
  const s = e.target.closest('[data-sub]');
  if (s) { E.subCompras = s.dataset.sub; try { localStorage.setItem('plan-sub-compras', E.subCompras); } catch (x) {} render(); return; }
  const pp = e.target.closest('[data-pedir-prov]');
  if (pp) { pedirProveedor(pp.dataset.pedirProv, pp); return; }
  const rc = e.target.closest('[data-recibido]');
  if (rc) { rc.disabled = true; cambiarPedido(rc.dataset.recibido, { estado: 'Recibido' }, 'Pedido marcado como recibido'); return; }
  const an = e.target.closest('[data-anular]');
  if (an) {
    if (an.dataset.confirmar !== '1') { an.dataset.confirmar = '1'; an.textContent = '¿Seguro? Pulsa otra vez'; return; }
    cambiarPedido(an.dataset.anular, { estado: 'Anulado' }, 'Pedido anulado'); return;
  }
  const ab = e.target.closest('[data-abrir]');
  if (ab) { const t = E.tareas.find(x => x.id === ab.dataset.abrir); if (t) abrirForm(t); }
});
document.addEventListener('change', e => {
  const ll = e.target.closest('[data-llegada]');
  if (ll && ll.value) cambiarPedido(ll.dataset.llegada, { llegada: ll.value }, 'Fecha de llegada actualizada');
  if (e.target.id === 'soloFalta') { E.soloFalta = e.target.checked; $('#stockBody').innerHTML = filasStock(); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'stockBuscar') { E.stockQ = e.target.value; $('#stockBody').innerHTML = filasStock(); }
});

let toastT;
function toast(txt, accion) {
  const t = $('#toast');
  t.textContent = txt;
  t.classList.toggle('accion', !!accion);
  if (accion) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = accion.texto;
    b.onclick = () => { t.classList.remove('ver'); accion.fn(); };
    t.appendChild(b);
  }
  t.classList.add('ver');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('ver'), accion ? 6000 : 2200);
}

/* ---------- Arranque ---------- */
render();
setTimeout(() => {
  if (!E.cargado) mostrarFallo('La app lleva 30 segundos esperando los datos del servidor. Comprueba tu conexión y recarga la página.');
}, 30000);
llamar('obtenerDatos').then(d => {
  if (!d) throw new Error('El servidor no ha devuelto datos.');
  aplicar(d);
}).catch(ex => {
  $('#main').innerHTML = '';
  mostrarFallo('No se pudo cargar la planificación. ' + ((ex && (ex.stack || ex.message)) || ex));
});
