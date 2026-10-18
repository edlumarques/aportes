/* App de Aportes — regras de cálculo (sem dependência de tela ou banco).
   Usado no navegador (window.Calc) e nos testes (Node). */
(function (root) {
  'use strict';

  const EPS = 1e-9;
  const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

  // Quantidade comprável conforme a regra de fração do ativo
  function arredondaQtd(qtd, fracao) {
    if (!(qtd > 0)) return 0;
    if (fracao === 'inteira') return Math.floor(qtd + EPS);
    if (fracao === 'centesimo') return Math.floor(qtd * 100 + EPS) / 100;
    return Math.floor(qtd * 1e8 + EPS) / 1e8; // livre (cripto): 8 casas
  }
  function unidadeMinima(fracao) {
    return fracao === 'inteira' ? 1 : fracao === 'centesimo' ? 0.01 : 1e-8;
  }

  /* Posição consolidada por ativo.
     ativos: [{id,...}], lancamentos: [{ativo_id, quantidade, preco, taxas}],
     cotacoes: {ativo_id: {preco, preco_venda, data, origem}} */
  function posicao(ativos, lancamentos, cotacoes) {
    const acc = {};
    for (const a of ativos) acc[a.id] = { qtd: 0, custo: 0 };
    for (const l of lancamentos) {
      const p = acc[l.ativo_id];
      if (!p) continue;
      p.qtd += Number(l.quantidade);
      p.custo += Number(l.quantidade) * Number(l.preco) + Number(l.taxas || 0);
    }
    return ativos.map((a) => {
      const p = acc[a.id];
      const cot = cotacoes[a.id] || null;
      const preco = cot ? Number(cot.preco) : null;
      const valor = preco != null ? p.qtd * preco : null;
      return {
        ...a,
        qtd: p.qtd,
        custo: p.custo,
        pm: p.qtd > 0 ? p.custo / p.qtd : null,
        preco,
        cotacao: cot,
        valor,
        resultado: valor != null ? valor - p.custo : null,
        resultadoPct: valor != null && p.custo > 0 ? valor / p.custo - 1 : null,
      };
    });
  }

  /* Sugestão do aporte da carteira.
     itens: [{id, ticker, peso, fracao, preco, valor}] — só ativos da carteira, ativos, com preço.
     aporte: valor da Parte B. modo: 'deficit' | 'simples'. */
  function sugerirCarteira(itens, aporte, modo) {
    const atual = itens.reduce((s, i) => s + (i.valor || 0), 0);
    const total = atual + aporte;
    const linhas = itens.map((i) => {
      const alvo = total * Number(i.peso);
      return { ...i, atual: i.valor || 0, alvo, deficit: Math.max(0, alvo - (i.valor || 0)) };
    });
    const somaDef = linhas.reduce((s, l) => s + l.deficit, 0);
    const somaPeso = linhas.reduce((s, l) => s + Number(l.peso), 0) || 1;

    for (const l of linhas) {
      if (modo === 'simples' || somaDef < EPS) l.sugestao = (aporte * Number(l.peso)) / somaPeso;
      else l.sugestao = (aporte * l.deficit) / somaDef;
      l.qtd = arredondaQtd(l.sugestao / l.preco, l.fracao);
      l.gasto = l.qtd * l.preco;
    }

    // Troco → ativo com maior déficit restante; se a unidade não couber, passa ao próximo.
    let troco = aporte - linhas.reduce((s, l) => s + l.gasto, 0);
    const restante = (l) => (modo === 'simples' ? l.alvo - (l.atual + l.gasto) : l.deficit - l.gasto);
    const fila = linhas.filter((l) => restante(l) > EPS).sort((a, b) => restante(b) - restante(a));
    for (const l of fila) {
      const custoUn = unidadeMinima(l.fracao) * l.preco;
      const n = Math.floor(troco / custoUn + EPS);
      if (n > 0) {
        const extra = arredondaQtd(n * unidadeMinima(l.fracao), l.fracao);
        l.qtd = arredondaQtd(l.qtd + extra, l.fracao) || l.qtd + extra;
        l.qtdTroco = extra;
        l.gasto = l.qtd * l.preco;
        troco = aporte - linhas.reduce((s, x) => s + x.gasto, 0);
      }
    }
    return {
      linhas,
      totalAtual: atual,
      totalProjetado: total,
      somaDeficit: somaDef,
      gasto: r2(linhas.reduce((s, l) => s + l.gasto, 0)),
      troco: r2(Math.max(0, troco)),
    };
  }

  function sugerirBtc(valor, preco) {
    if (!(valor > 0) || !(preco > 0)) return { qtd: 0, gasto: 0 };
    const qtd = arredondaQtd(valor / preco, 'livre');
    return { qtd, gasto: valor };
  }

  // Períodos decorridos desde o início (inclui o período atual)
  function periodosDecorridos(inicioISO, hojeISO, periodicidade, nAportesRegulares) {
    if (periodicidade === 'livre' || !inicioISO) return nAportesRegulares || 0;
    const ini = new Date(inicioISO + 'T00:00:00Z');
    const hoje = new Date(hojeISO + 'T00:00:00Z');
    if (hoje < ini) return 0;
    const dias = Math.floor((hoje - ini) / 86400000);
    if (periodicidade === 'semanal') return Math.floor(dias / 7) + 1;
    if (periodicidade === 'quinzenal') return Math.floor(dias / 14) + 1;
    let meses = (hoje.getUTCFullYear() - ini.getUTCFullYear()) * 12 + (hoje.getUTCMonth() - ini.getUTCMonth());
    if (hoje.getUTCDate() < ini.getUTCDate()) meses -= 1;
    return meses + 1;
  }

  // ---------- Importação da planilha (formato "simulação aportes") ----------
  function serialParaISO(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const m = String(v).match(/(\d{4})-(\d{2})-(\d{2})/) || String(v).match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return null;
    return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`;
  }
  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

  /* XLSX = biblioteca SheetJS; wb = workbook lido com {cellDates:false}.
     Retorna { lancamentos: [{ticker, semana, data, valor, quantidade, preco}],
               cotacoes: [{ticker, preco, preco_venda}], avisos: [] } */
  function lerPlanilha(XLSX, wb) {
    const out = { lancamentos: [], cotacoes: [], avisos: [] };
    const nomeParaTicker = (n) => (norm(n) === 'bitcoin' ? 'BTC' : String(n).trim().toUpperCase());

    for (const nome of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: null });
      const hIdx = rows.findIndex((r) => r && r.some((c) => norm(c) === 'aporte') && r.some((c) => norm(c) === 'data'));
      if (hIdx < 0) continue;
      const h = rows[hIdx].map(norm);
      const cSem = h.indexOf('semana'), cAp = h.indexOf('aporte'), cData = h.indexOf('data');
      const cQtd = cData + 1;
      const ticker = nomeParaTicker(nome);
      for (const r of rows.slice(hIdx + 1)) {
        if (!r) continue;
        const valor = Number(r[cAp]), qtd = Number(r[cQtd]);
        if (!(valor > 0) || !(qtd > 0)) continue;
        const data = serialParaISO(r[cData]);
        if (!data) { out.avisos.push(`${nome}: linha sem data ignorada`); continue; }
        out.lancamentos.push({ ticker, semana: Number(r[cSem]) || null, data, valor, quantidade: qtd, preco: valor / qtd });
      }
    }

    // Cotações salvas na aba "Inicial" (coluna Ativo × Valor por unidade)
    const ini = wb.Sheets['Inicial'];
    if (ini) {
      const rows = XLSX.utils.sheet_to_json(ini, { header: 1, raw: true, defval: null });
      const hIdx = rows.findIndex((r) => r && r.some((c) => norm(c) === 'valor por unidade'));
      if (hIdx >= 0) {
        const cAt = rows[hIdx].map(norm).indexOf('ativo');
        const cPr = rows[hIdx].map(norm).indexOf('valor por unidade');
        for (const r of rows.slice(hIdx + 1)) {
          if (!r || r[cAt] == null) break;
          let t = String(r[cAt]).trim().toUpperCase();
          if (t === 'TOTAL') break;
          if (t === 'BTCBRL') t = 'BTC';
          const p = Number(r[cPr]);
          if (p > 0) out.cotacoes.push({ ticker: t, preco: p, preco_venda: null });
        }
      }
    }
    // PU de venda do Tesouro (linha mais recente da aba de preços)
    const tes = wb.Sheets['precotaxatesourodireto'];
    if (tes) {
      const rows = XLSX.utils.sheet_to_json(tes, { header: 1, raw: true, defval: null });
      const h = (rows[0] || []).map(norm);
      const cBase = h.indexOf('data base'), cVenda = h.indexOf('pu venda manha');
      let melhor = null;
      for (const r of rows.slice(1)) {
        if (!r || !(Number(r[cVenda]) > 0)) continue;
        if (!melhor || Number(r[cBase]) > Number(melhor[cBase])) melhor = r;
      }
      const ntnb = out.cotacoes.find((c) => c.ticker.startsWith('NTNB'));
      if (melhor && ntnb) ntnb.preco_venda = Number(melhor[cVenda]);
    }
    return out;
  }

  // Agrupa lançamentos importados em aportes (um por semana)
  function agruparEmAportes(lancs) {
    const grupos = new Map();
    for (const l of lancs) {
      const k = l.semana != null ? 's' + l.semana : 'd' + l.data;
      if (!grupos.has(k)) grupos.set(k, { data: l.data, valor_btc: 0, valor_carteira: 0, itens: [] });
      const g = grupos.get(k);
      if (l.data < g.data) g.data = l.data;
      if (l.ticker === 'BTC') g.valor_btc += l.valor; else g.valor_carteira += l.valor;
      g.itens.push(l);
    }
    return [...grupos.values()].sort((a, b) => (a.data < b.data ? -1 : 1));
  }

  const api = { arredondaQtd, unidadeMinima, posicao, sugerirCarteira, sugerirBtc, periodosDecorridos,
                lerPlanilha, agruparEmAportes, serialParaISO, r2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
