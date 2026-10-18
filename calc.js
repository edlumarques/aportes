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

  // ---------- Projeção de IR em caso de venda total ----------
  // Regras (Brasil, pessoa física). Ficam aqui para facilitar ajuste se a lei mudar.
  const REGRAS_IR = {
    rv15: { aliquota: 0.15, darf: '6015' },                       // ETFs de renda variável
    tesouro: [[180, 0.225], [360, 0.20], [720, 0.175], [Infinity, 0.15]], // dias corridos → alíquota
    iof: [96,93,90,86,83,80,76,73,70,66,63,60,56,53,50,46,43,40,36,33,30,26,23,20,16,13,10,6,3], // % do rendimento, dias 1..29
    criptoNacional: { isencaoVendasMes: 35000, darf: '4600',
      faixas: [[5e6, 0.15], [10e6, 0.175], [30e6, 0.20], [Infinity, 0.225]] }, // por parcela do lucro
    criptoExterior: { aliquota: 0.15 },
  };
  const diasEntre = (a, b) => Math.floor((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
  function aliquotaTesouro(dias) { for (const [lim, a] of REGRAS_IR.tesouro) if (dias <= lim) return a; return 0.15; }
  function iofPct(dias) { return dias >= 30 || dias < 1 ? 0 : REGRAS_IR.iof[dias - 1] / 100; }
  function irProgressivo(lucro) {
    let ir = 0, base = 0;
    for (const [teto, a] of REGRAS_IR.criptoNacional.faixas) {
      const parcela = Math.min(lucro, teto) - base;
      if (parcela <= 0) break;
      ir += parcela * a; base = teto;
    }
    return ir;
  }
  function addDias(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  // Último dia útil (seg–sex) do mês seguinte; feriados não são considerados
  function vencimentoDarf(hojeISO) {
    const d = new Date(hojeISO + 'T00:00:00Z');
    const fim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0));
    while (fim.getUTCDay() === 0 || fim.getUTCDay() === 6) fim.setUTCDate(fim.getUTCDate() - 1);
    return fim.toISOString().slice(0, 10);
  }

  /* pos: saída de posicao(); lancs: lançamentos; cot: {ativo_id: {preco, preco_venda}};
     opts: { hoje, btcRegime: 'nacional'|'exterior', prejuizoRv: prejuízo acumulado a compensar } */
  function projecaoIR(pos, lancs, cot, opts) {
    const hoje = opts.hoje, out = { rv: [], tesouro: [], cripto: [], darfs: [], avisos: [] };
    const comQtd = pos.filter((p) => p.qtd > 1e-12);

    // ETFs / renda variável: lucro e prejuízo se compensam no mês
    for (const p of comQtd.filter((p) => p.classe_ir === 'rv15')) {
      if (p.preco == null) { out.avisos.push(`${p.ticker}: sem cotação, fora da simulação`); continue; }
      out.rv.push({ ticker: p.ticker, bruto: p.valor, custo: p.custo, lucro: p.valor - p.custo });
    }
    const lucroRv = out.rv.reduce((s, x) => s + x.lucro, 0);
    const prej = Math.max(0, Number(opts.prejuizoRv) || 0);
    const baseRv = Math.max(0, lucroRv - prej);
    const irRv = baseRv * REGRAS_IR.rv15.aliquota;
    out.resumoRv = { lucro: lucroRv, prejuizoUsado: Math.min(prej, Math.max(0, lucroRv)), base: baseRv, ir: irRv,
                     prejuizoSobra: Math.max(0, prej - Math.max(0, lucroRv)) + Math.max(0, -lucroRv) };
    // rateio do IR por ativo (só para exibir o líquido por linha)
    const somaPos = out.rv.reduce((s, x) => s + Math.max(0, x.lucro), 0);
    for (const x of out.rv) { x.ir = somaPos > 0 ? irRv * Math.max(0, x.lucro) / somaPos : 0; x.liquido = x.bruto - x.ir; }
    if (irRv > 0.005) out.darfs.push({ codigo: REGRAS_IR.rv15.darf, desc: 'ETFs (renda variável)', valor: irRv, vencimento: vencimentoDarf(hoje) });

    // Tesouro: tabela regressiva compra a compra, retido na fonte
    for (const p of comQtd.filter((p) => p.classe_ir === 'tesouro')) {
      const c = cot[p.id] || {};
      let pu = Number(c.preco_venda);
      if (!(pu > 0)) { pu = Number(c.preco); out.avisos.push(`${p.ticker}: sem PU de venda; usado o PU de compra`); }
      if (!(pu > 0)) { out.avisos.push(`${p.ticker}: sem cotação, fora da simulação`); continue; }
      const lotes = lancs.filter((l) => l.ativo_id === p.id).map((l) => {
        const q = Number(l.quantidade), custo = q * Number(l.preco) + Number(l.taxas || 0);
        const dias = Math.max(0, diasEntre(l.data, hoje));
        const bruto = q * pu, rend = bruto - custo;
        const iof = rend > 0 ? rend * iofPct(dias) : 0;
        const aliq = aliquotaTesouro(dias);
        const ir = rend - iof > 0 ? (rend - iof) * aliq : 0;
        return { data: l.data, qtd: q, dias, custo, bruto, rend, iof, aliq, ir, liquido: bruto - iof - ir,
                 data15: addDias(l.data, 721) };
      });
      const s = (k) => lotes.reduce((t, x) => t + x[k], 0);
      out.tesouro.push({ ticker: p.ticker, pu, lotes, bruto: s('bruto'), custo: s('custo'), lucro: s('rend'),
                         iof: s('iof'), ir: s('ir'), liquido: s('liquido') });
    }

    // Cripto
    for (const p of comQtd.filter((p) => p.classe_ir === 'cripto')) {
      if (p.preco == null) { out.avisos.push(`${p.ticker}: sem cotação, fora da simulação`); continue; }
      const lucro = p.valor - p.custo;
      let ir = 0, regra;
      if (opts.btcRegime === 'exterior') {
        ir = Math.max(0, lucro) * REGRAS_IR.criptoExterior.aliquota;
        regra = 'Exterior: 15% sobre o lucro, na declaração anual';
      } else if (p.valor <= REGRAS_IR.criptoNacional.isencaoVendasMes) {
        regra = `Isento: vendas no mês até ${REGRAS_IR.criptoNacional.isencaoVendasMes.toLocaleString('pt-BR')} reais`;
      } else {
        ir = lucro > 0 ? irProgressivo(lucro) : 0;
        regra = 'Vendas acima de R$ 35 mil no mês: 15% sobre o lucro (faixas maiores acima de R$ 5 milhões)';
      }
      out.cripto.push({ ticker: p.ticker, bruto: p.valor, custo: p.custo, lucro, ir, liquido: p.valor - ir, regra });
      if (ir > 0.005 && opts.btcRegime !== 'exterior')
        out.darfs.push({ codigo: REGRAS_IR.criptoNacional.darf, desc: `${p.ticker} (ganho de capital)`, valor: ir, vencimento: vencimentoDarf(hoje) });
      if (ir > 0.005 && opts.btcRegime === 'exterior')
        out.darfs.push({ codigo: 'DIRPF', desc: `${p.ticker} (exterior, declaração anual)`, valor: ir, vencimento: `${Number(hoje.slice(0, 4)) + 1}-05-31` });
    }

    const todos = [...out.rv, ...out.tesouro, ...out.cripto];
    out.total = {
      bruto: todos.reduce((s, x) => s + x.bruto, 0),
      custo: todos.reduce((s, x) => s + x.custo, 0),
      ir: irRv + out.tesouro.reduce((s, x) => s + x.ir + x.iof, 0) + out.cripto.reduce((s, x) => s + x.ir, 0),
    };
    out.total.lucro = out.total.bruto - out.total.custo;
    out.total.liquido = out.total.bruto - out.total.ir;
    return out;
  }

  const api = { arredondaQtd, unidadeMinima, posicao, sugerirCarteira, sugerirBtc, periodosDecorridos,
                lerPlanilha, agruparEmAportes, serialParaISO, r2,
                projecaoIR, vencimentoDarf, aliquotaTesouro, iofPct, irProgressivo, REGRAS_IR };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
