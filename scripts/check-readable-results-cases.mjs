import assert from "node:assert/strict"

/** Usa el arranque/teardown y ventana real del verificador monetario existente. */
export async function checkReadableResults({ page, report, fill, calculate, edit, screenshot, native, isNative, base }) {
  async function fresh(scenario) {
    await page.goto(scenario ? `${base}dev/inverse.html?case=${scenario}` : `${base}dev/money.html`, { waitUntil: "networkidle" })
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled)
  }
  async function row(label, expected) {
    const value = page.locator(".detail-row").filter({ has: page.getByText(label, { exact: true }) }).locator("dd")
    assert.equal(await value.textContent(), expected, label)
  }
  async function basic() {
    assert.equal(await page.getByRole("button", { name: "Guardar", exact: true }).count(), 0)
    assert.equal(await page.getByRole("button", { name: "Exportar PDF", exact: true }).isDisabled(), true)
    assert.equal(await page.locator(".fiscal-insights > summary").innerText(), "Detalles del cálculo")
    assert.equal(await page.locator(".fiscal-insights").getAttribute("open"), null)
    assert.equal(await page.locator(".technical-result-details").getAttribute("open"), null)
    assert.equal(await page.locator(".technical-result-body").isVisible(), false)
    assert((await page.locator(".result-interpretation").innerText()).includes("no homologada con SUA ni CONTPAQi"))
    assert((await page.locator(".result-interpretation").innerText()).includes("no determinado, no cero"))
    assert(!(await page.locator(".results-section").innerText()).includes("guardado automáticamente"))
    assert(!(await page.locator(".results-section").innerText()).includes("Búsqueda, alternativas, supuestos y advertencias"))
    assert((await page.locator(".capture-summary-values").innerText()).includes("febrero de 2026"))
  }
  async function measure(name, ordinary = true) {
    await page.evaluate(() => scrollTo(0, 0))
    const metrics = await page.evaluate(name => ({ name, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
      scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight,
      scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
      panels: [...document.querySelectorAll(".detail-panel")].map(e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom } }),
      fonts: [...document.querySelectorAll(".primary-amount, .summary-card p, .detail-row")].slice(0, 6).map(e => ({ selector: e.className, font: getComputedStyle(e).fontFamily, size: getComputedStyle(e).fontSize })),
    }), name)
    report.metrics.push(metrics)
    assert(metrics.scrollWidth <= metrics.clientWidth, `Horizontal: ${name}`)
    if (ordinary && metrics.viewport[0] === 1180) assert(metrics.scrollHeight <= metrics.clientHeight, `Scroll ordinario: ${JSON.stringify(metrics)}`)
  }
  for (const c of [
    { name: "directo mensual", amount: "15000.00", period: "monthly", imss: true, net: "$ 13,202.64", tax: "$ 1,402.82", quota: "$ 394.54" },
    { name: "directo sin IMSS", amount: "15000.00", period: "monthly", imss: false, net: "$ 13,597.18", tax: "$ 1,402.82", quota: "$ 0.00" },
    { name: "directo semanal", amount: "3500.00", period: "weekly", imss: true, net: "$ 3,076.67", tax: "$ 331.27", quota: "$ 92.06" },
  ]) {
    await fresh(); await fill(c.amount, "gross-to-net", c.period, c.imss); await calculate(); await basic()
    assert.equal(await page.locator(".primary-amount").innerText(), c.net)
    assert.equal(await page.locator(".summary-isr p").innerText(), c.tax)
    assert.equal(await page.locator(".summary-imss p").innerText(), c.quota)
    await row("ISR calculado por tarifa", c.tax)
    await row("ISR retenido estimado", c.tax)
    await row("IMSS realmente descontado", c.quota)
    if (!c.imss) {
      await row("IMSS calculado (cuota obrera)", "$ 394.54")
      assert((await page.locator(".result-interpretation").innerText()).includes("no representa una exención legal"))
    }
    await measure(c.name)
    report.fiscal.push({ ...c, obtained: await page.locator(".primary-amount").innerText(), snapshot: await page.evaluate(() => window.__moneyVerification.state.snapshot) })
    if (c.name === "directo mensual") await screenshot("results-direct")
  }
  report.checks.push("tres regresiones directas, ISR por tarifa/retenido e IMSS calculado/descontado; exclusión simulada visible")

  for (const c of [
    { name: "inverso mensual exacto", amount: "13202.64", period: "monthly", gross: "$ 15,000.00", alternatives: ["$ 15,000.00"] },
    { name: "inverso semanal múltiple", amount: "3076.67", period: "weekly", gross: "$ 3,499.99", alternatives: ["$ 3,499.99", "$ 3,500.00"] },
    { name: "inverso mensual múltiple", amount: "10500.00", period: "monthly", gross: "$ 11,093.07", alternatives: ["$ 11,093.07", "$ 11,714.44"] },
  ]) {
    await fresh(); await fill(c.amount, "net-to-gross", c.period); await calculate(); await basic()
    assert.equal(await page.locator(".primary-amount").innerText(), c.gross)
    assert.equal(await page.locator('[data-inverse="difference"]').innerText(), "$ 0.00")
    assert((await page.locator("#result-message").innerText()).includes("Bruto mínimo demostrado en el dominio analizado"))
    const original = await page.locator(".summary-grid").innerText()
    await measure(c.name)
    if (c.amount === "13202.64") await screenshot("results-inverse")
    const summary = page.locator(".fiscal-insights > summary")
    await summary.focus(); await page.keyboard.press("Enter")
    assert.equal(await page.locator(".fiscal-insights").getAttribute("open"), "")
    assert.equal(await page.locator(".fiscal-raw-value").isVisible(), false)
    await page.keyboard.press("Tab")
    assert.equal(await page.evaluate(() => document.activeElement?.matches(".verified-alternatives > summary")), true)
    await page.keyboard.press("Space")
    const list = await page.getByRole("list", { name: "Brutos exactos verificados" }).innerText()
    for (const candidate of c.alternatives) assert(list.includes(candidate))
    assert((await page.locator(".inverse-alternatives").innerText()).includes("no fuera de él"))
    await page.keyboard.press("Tab")
    assert.equal(await page.evaluate(() => document.activeElement?.matches(".technical-result-details > summary")), true)
    await page.keyboard.press("Enter")
    assert.equal(await page.locator(".fiscal-raw-value").isVisible(), true)
    assert((await page.locator(".technical-result-body").innerText()).includes("mx-fiscal-2026-source-v3"))
    assert((await page.locator(".technical-result-body").innerText()).includes("Certificados de cobertura utilizados"))
    assert.equal(await page.locator(".fiscal-insights-body").evaluate(e => getComputedStyle(e).overflowY), "visible")
    assert.equal(await page.locator(".summary-grid").innerText(), original, "Abrir detalles no sustituye el bruto recomendado")
    await measure(`${c.name} detalles abiertos`, false)
    if (c.amount === "10500.00") {
      await row("ISR calculado por tarifa", "$ 847.94"); await row("ISR retenido estimado", "$ 312.29")
      assert.equal(await page.locator('[data-subsidy="applied"]').innerText(), "$ 535.65")
      assert((await page.locator(".fiscal-insights-body").innerText()).includes("no se vuelve a sumar al neto"))
    }
    await summary.focus(); await page.keyboard.press("Space")
    await measure(`${c.name} vuelve a cerrar`)
    report.fiscal.push({ ...c, obtained: await page.locator(".primary-amount").innerText(), alternatives: list })
  }
  report.checks.push("inversos exacto/múltiples: tres casos reales; alternativas informativas y garantía circunscrita al dominio")
  report.checks.push("teclado Enter/Espacio/Tab en ambos niveles; certificados/factor interno plegados, scroll natural y desglose inmutable")

  for (const c of [
    { scenario: "approximate", amount: "5557.04", period: "fortnightly", title: "Bruto aproximado", state: "approximate", text: "Aproximado:" },
    { scenario: "limited", amount: "13202.64", period: "monthly", title: "Bruto mínimo demostrado", state: "limited", text: "Búsqueda limitada" },
    { scenario: "empty-limited", amount: "1.00", period: "monthly", title: "Bruto no determinado", state: "limited", text: "Resultado no determinable" },
    { scenario: "unresolved", amount: "9451.20", period: "monthly", title: "Bruto no determinado", state: "blocked", text: "Condición fiscal pendiente" },
  ]) {
    await fresh(c.scenario); await fill(c.amount, "net-to-gross", c.period); await calculate(); await basic()
    assert.equal(await page.locator(".primary-result h3").innerText(), c.title)
    assert.equal(await page.locator(".results-section").getAttribute("data-result-state"), c.state)
    assert((await page.locator("#result-message").innerText()).includes(c.text))
    assert.equal(await page.locator(".result-check .lucide-check").count(), 0)
    if (c.scenario === "approximate") {
      assert.equal(await page.locator('[data-inverse="difference"]').innerText(), "−$ 0.01")
      assert((await page.locator(".result-interpretation").innerText()).includes("no es una coincidencia exacta"))
    }
    if (c.scenario === "limited") {
      const message = await page.locator("#result-message").innerText()
      assert(message.includes("en el dominio analizado"), "El mínimo local certificado no implica cobertura completa")
    }
    if (c.scenario === "empty-limited" || c.scenario === "unresolved") assert.equal(await page.locator(".primary-amount").innerText(), "$ —")
    if (c.scenario === "unresolved") assert.equal(await page.locator("#minimum-month-ack").evaluate(e => e.closest("details") === null), true)
    await measure(c.scenario, false); await screenshot(`results-${c.scenario}`)
    report.checks.push(`estado real ${c.scenario}: garantía fiel, advertencia visible y sin distintivo de éxito contradictorio`)
  }

  await fresh(); await fill("9451.20", "net-to-gross"); await calculate()
  assert.equal(await page.locator(".primary-result h3").innerText(), "Bruto encontrado")
  assert((await page.locator("#result-message").innerText()).includes("mínimo no demostrado"))
  assert.equal(await page.locator('[data-inverse="obtained"]').innerText(), "$ 9,451.20")
  assert.equal(await page.evaluate(() => window.__moneyVerification.state.outcome.presentation.inverse.minimumProven), false)
  assert.equal(await page.locator(".result-check .lucide-check").count(), 0)
  assert.equal(await page.locator("#minimum-month-ack").isChecked(), false)
  await measure("bruto encontrado sin mínimo demostrado", false)
  await screenshot("results-found-only")
  report.checks.push("candidato ordinario exacto sin mínimo demostrado: Bruto encontrado, condición mensual visible y sin éxito")

  await fresh(); await fill("9451.20"); await calculate()
  assert.equal(await page.locator("#minimum-month-ack").isChecked(), false)
  assert.equal(await page.locator("#minimum-month-ack").evaluate(e => e.closest("details") === null), true)
  await page.locator("#minimum-month-ack").focus(); await page.keyboard.press("Space")
  await page.getByRole("button", { name: "Recalcular con hipótesis" }).focus(); await page.keyboard.press("Enter")
  await page.waitForFunction(() => document.querySelector(".primary-amount")?.textContent === "$ 9,451.20")
  assert.equal(await page.locator(".result-check .lucide-check").count(), 0)
  assert((await page.locator(".result-interpretation").innerText()).includes("artículo 36 LSS"))
  assert((await page.locator(".result-interpretation").innerText()).includes("hipótesis mensual expresa"))
  const minimumTariff = await page.evaluate(() => window.__moneyVerification.state.outcome.report.isr.accordingToTariff.amount)
  assert.notEqual(minimumTariff, "0.00")
  await row("ISR calculado por tarifa", `$ ${minimumTariff}`)
  await row("ISR retenido estimado", "$ 0.00")
  assert.equal(await page.locator('[data-subsidy="applied"]').innerText(), "$ 0.00")
  await screenshot("results-minimum-conditioned")
  report.checks.push("mínimo directo: confirmación artículo 96 siempre accesible; hipótesis no equivale a certeza, absorción LSS 36 y subsidio no sumado")

  await fresh(); await fill("9451.19"); await calculate()
  assert.equal(await page.locator(".primary-amount").innerText(), "$ —")
  assert((await page.locator(".result-interpretation").innerText()).includes("mínimo"))
  await fresh("missing-parameters"); await fill("15000.00"); await calculate()
  assert.equal(await page.locator(".primary-amount").innerText(), "$ —")
  assert.equal(await page.locator(".result-check .lucide-check").count(), 0)
  assert((await page.locator(".result-interpretation").innerText()).length > 100)
  report.checks.push("bajo mínimo y parámetros ausentes: motivos visibles, desconocidos en — y ninguna cantidad inventada")

  await fresh(); await fill("00015000.50", "gross-to-net", "monthly", false)
  for (const [id, value] of [["bonus-days", "18.50"], ["vacation-days", "20.25"], ["vacation-premium", "30.50"]]) await page.locator(`#${id}`).fill(value)
  await calculate(); await edit()
  for (const [id, value] of [["salary", "00,015,000.50"], ["bonus-days", "18.50"], ["vacation-days", "20.25"], ["vacation-premium", "30.50"], ["effective-date", "2026-02-01"]]) assert.equal(await page.locator(`#${id}`).inputValue(), value)
  assert.equal(await page.locator("#exclude-imss").isChecked(), true)
  report.checks.push("Editar datos conserva importe canónico/formato, fecha manual, prestaciones personalizadas e IMSS No")

  await fresh(); await fill("13202.64", "net-to-gross"); await calculate()
  if (isNative) report.resizes.push(native("resize", ["-Width", "900", "-Height", "600"]))
  else await page.setViewportSize({ width: 900, height: 600 })
  await page.waitForFunction(() => innerWidth === 900)
  await measure("inverso mínimo 900"); await screenshot("results-inverse-900")
  await page.locator(".fiscal-insights > summary").focus(); await page.keyboard.press("Enter")
  await page.locator(".technical-result-details > summary").focus(); await page.keyboard.press("Space")
  await measure("detalles técnicos mínimo 900", false)
  if (isNative) report.resizes.push(native("resize", ["-Width", "1180", "-Height", "760"]))
  else await page.setViewportSize({ width: 1180, height: 760 })
  await page.waitForFunction(() => innerWidth === 1180)
  report.checks.push("900×600: scroll vertical natural y técnicos accesibles por teclado, sin desbordamiento horizontal")

  await fresh("deferred"); await fill("13202.64", "net-to-gross"); await page.locator("#salary").press("Enter")
  await page.getByRole("button", { name: "Cancelar", exact: true }).waitFor()
  await page.getByRole("button", { name: "Cancelar", exact: true }).focus(); await page.keyboard.press("Space")
  await page.evaluate(() => window.__inverseVerification.resolve(0))
  assert.equal(await page.locator(".results-section").getAttribute("data-result-state"), "cancelled")
  assert.equal(await page.locator(".primary-amount").innerText(), "$ —")
  assert.equal(await page.locator(".technical-result-details").count(), 0)
  await edit(); await fill("15000.00"); await calculate()
  assert.equal(await page.locator(".primary-amount").innerText(), "$ 13,202.64")
  await fresh("deferred"); await fill("13202.64", "net-to-gross"); await page.locator("#salary").press("Enter")
  await page.getByRole("button", { name: "Editar datos", exact: true }).waitFor()
  await page.getByRole("button", { name: "Limpiar", exact: true }).click()
  await page.evaluate(() => window.__inverseVerification.resolve(0))
  assert.equal(await page.locator(".results-section").count(), 0)
  assert.equal(await page.locator("#salary").inputValue(), "")
  report.checks.push("cancelar por teclado y limpiar descartan respuesta inversa tardía y todo reporte técnico obsoleto; nuevo cálculo correcto")
}
