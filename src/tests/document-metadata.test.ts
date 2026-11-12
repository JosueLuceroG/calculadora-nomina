import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("metadatos locales de la ventana WebView2", () => {
  it.each(["index.html", "dev/inverse.html", "dev/results.html"])("%s declara un favicon autocontenido y evita el 404 implícito de WebView2", entry => {
    const html = readFileSync(new URL(`../../${entry}`, import.meta.url), "utf8")
    const href = html.match(/<link\b(?=[^>]*\brel="icon")[^>]*\bhref="([^"]+)"/)?.[1]
    expect(href).toMatch(/^data:image\/svg\+xml,/)
    const svg = decodeURIComponent(href!.slice(href!.indexOf(",") + 1))
    expect(svg).toContain('<svg xmlns=')
    expect(svg).toContain("http://www.w3.org/2000/svg")
    expect(svg).toContain("</svg>")
    expect(svg).not.toMatch(/(?:href|src)=/)
  })
})
