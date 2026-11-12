# Motor de cálculo

Este documento explica qué calcula el motor, en qué orden, con qué redondeos y bajo qué supuestos. La intención es que un revisor pueda reproducir un resultado sin leer la interfaz y sin confundir una convención del simulador con una obligación fiscal.

## Alcance

El motor estima un recibo ordinario fijo bajo un perfil estándar:

- Ejercicio **2026**.
- Zona salarial **general**.
- Salario ordinario fijo **totalmente gravado**.
- Periodicidades de **7, 15 y 30 días**.
- Prestaciones anuales declaradas: aguinaldo, vacaciones y prima vacacional.
- IMSS obrero incluido o excluido por un interruptor explícito.
- Sin ingresos variables, exentos, incidencias, otros patrones, CFDI, SUA, CONTPAQi ni conciliación mensual real.

El motor no certifica percepciones, retenciones practicadas ni liquidaciones. Devuelve una **estimación** con advertencias y valores desconocidos cuando el contexto no alcanza.

## Precisión decimal

La política `decimal-50-v1` define:

| Parámetro | Valor |
| --- | --- |
| Dígitos significativos | 50 |
| Dígitos enteros máximos | 20 |
| Dígitos fraccionarios máximos | 100 |
| Longitud máxima de texto | 256 |
| Decimales monetarios | 2 |
| Redondeo de precisión | half-up |
| Redondeo de presentación | half-up |

Los importes se conservan como cadenas decimales exactas. Los límites son técnicos, no topes fiscales. Un `null` significa “no determinable” y no se sustituye por cero.

## Flujo directo

```text
bruto del periodo
  → salario diario contractual
  → factor de integración
  → SDI teórico
  → SBC estimado
  → cuotas obreras IMSS
  → ISR por tarifa
  → subsidio al empleo
  → decisión de retención
  → neto estimado
```

Cada etapa reutiliza los valores internos de la anterior. No se redondea a centavos entre etapas salvo que la política lo indique.

### 1. Integración salarial

Política: `theoretical-fixed-integration-2026-v1`.

```text
salario diario contractual = bruto del periodo / divisor contractual
divisor contractual ∈ {7, 15, 30}

factor de integración = 1 + (aguinaldo + vacaciones × prima / 100) / 365
SDI teórico = salario diario contractual × factor de integración
```

Supuestos:

- El divisor es contractual; no representa días cotizados reales.
- Las vacaciones pagadas ya están en el salario ordinario; solo la prima incrementa el factor.
- Las prestaciones se declaran; no se infiere antigüedad ni pago efectivo.
- El SDI es teórico: no incluye pisos, topes ni SBC registrado.

### 2. SBC estimado

Política: `estimated-sbc-general-2026-half-up-v1`.

```text
límite inferior = salario mínimo general diario
límite superior = UMA diaria × múltiplo de tope SBC
SBC interno = min(max(SDI teórico, límite inferior), límite superior)
SBC estimado = redondeo half-up a centavos
```

Orden: SDI interno → límites legales → redondeo a centavos → verificación de que el SBC no salga del intervalo.

Si el salario diario contractual sin redondear es inferior al mínimo general, se conserva una advertencia. Estimar el piso de cotización no corrige ni aumenta el salario capturado. El resultado es un SBC estimado, no un SBC comunicado al IMSS.

### 3. Cuotas obreras IMSS

Política: `standard-worker-imss-general-2026-half-up-per-branch-v1`.

Ramos:

1. `pensioner-medical`
2. `cash-benefits`
3. `disability-life`
4. `unemployment-old-age`
5. `excess-medical`

```text
base diaria = SBC estimado
  (o excedente del SBC sobre el umbral, para excess-medical)

cuota diaria = base diaria × tasa obrera
cuota del periodo = cuota diaria × días de referencia
cuota del ramo = redondeo half-up a centavos
total = suma de los cinco ramos ya redondeados
```

Días de referencia: 7, 15 o 30 según periodicidad. Son una convención de simulación, no días cotizados reales.

La cuota calculada se distribuye en:

- **Descontada:** IMSS incluido y salario superior al mínimo.
- **Absorbida por el patrón:** salario diario contractual exactamente igual al mínimo general, por LSS 36.
- **Excluida por simulación:** IMSS desactivado sin absorción legal.

La absorción legal tiene prioridad sobre el interruptor de exclusión. “IMSS No” no representa exención legal, falta de aseguramiento ni pago adicional del patrón. Un salario inferior al mínimo bloquea las cuotas incluso con IMSS excluido.

Ejemplo de referencia: mensual 15,000.00, prestaciones 15/12/25, febrero 2026 → SBC 524.66 y cuotas 59.02 + 39.35 + 98.37 + 177.07 + 20.73 = **394.54**.

### 4. ISR por tarifa

Política: `standard-isr-tariff-2026-final-half-up-v1`.

La base gravable es el **bruto ordinario del periodo sin descontar IMSS**. Se selecciona la tarifa semanal, quincenal o mensual y se busca el tramo con límites inclusivos en centavos.

```text
excedente = base - límite inferior
impuesto marginal = excedente × tasa / 100
ISR interno = cuota fija + impuesto marginal
ISR por tarifa = redondeo half-up a centavos
```

Orden exacto:

1. Calcular el excedente exacto.
2. Calcular el impuesto marginal exacto.
3. Sumar la cuota fija.
4. Redondear una sola vez al centavo final.

Una base de cero produce ISR cero sin seleccionar ni extender un tramo debajo del primer límite de 0.01. Los importes inválidos o fuera de cobertura producen valores nulos con incidencias.

La tarifa no evalúa por sí sola el subsidio, la excepción por salario mínimo ni la retención final. Esas etapas se reportan por separado.

### 5. Subsidio al empleo

Política: `standard-employment-subsidy-2026-period-half-up-v1`.

La referencia mensual estimada es una convención:

```text
semanal:    bruto × 30 / 7
quincenal:  bruto × 2
mensual:    bruto mensual
```

La elegibilidad compara productos exactos contra el límite mensual oficial, sin redondear previamente la referencia. La cuota mensual teórica es:

```text
cuota mensual = UMA mensual oficial × porcentaje versionado
```

Para periodos menores:

```text
cuota del periodo = cuota mensual × días de referencia / divisor normativo
```

El periodo mensual usa la cuota mensual completa. Después se aplica el límite mensual por pago, la elegibilidad y el redondeo half-up al centavo. La aplicación potencial es el menor entre subsidio determinado e ISR por tarifa.

```text
ISR después del subsidio = ISR por tarifa - subsidio aplicado
excedente no entregado = subsidio determinado - subsidio aplicado
```

El excedente no se paga en efectivo, no se agrega al neto y no se traslada a ISR posterior. No se simula la conciliación mensual ni la elección de empleador. El ISR después del subsidio es **provisional**, no retención final.

Ejemplo: mensual 9,451.20 en febrero, ISR por tarifa 669.31, subsidio 535.65, aplicación 535.65, ISR provisional **133.66**.

### 6. Retención y neto

Política: `standard-gross-to-net-2026-component-cent-reconciliation-v1`.

El neto se compone una sola vez:

```text
neto = bruto del periodo - ISR retenido estimado - IMSS descontado
```

No se recalcula IMSS ni subsidio por separado. La decisión de retención depende del salario y del contexto mensual declarado:

| Situación | Resultado |
| --- | --- |
| Diario contractual superior al mínimo | Se reutiliza el ISR provisional como retención estimada |
| Diario exactamente en el mínimo, contexto `unconfirmed` | ISR retenido y neto nulos |
| Diario exactamente en el mínimo, hipótesis mensual explícita | No retención condicionada LISR 96; ISR retenido 0.00 |
| Diario inferior al mínimo | Bloqueado; no se determina neto |

La hipótesis de no retención exige:

- Mes civil coincidente con la fecha normativa.
- `noOtherSalaryPayments: true`.
- Reconocimiento explícito de que es una simulación no verificada, no una nómina real.

El subsidio determinado se separa en aplicado, potencial desplazado por la no retención y excedente previo sobre ISR por tarifa. Las categorías son excluyentes y no se reasignan entre sí.

Ejemplos de control, febrero 2026 y prestaciones 15/12/25:

| Caso | Bruto | Neto |
| --- | --- | --- |
| Mensual, IMSS sí | 15,000.00 | **13,202.64** |
| Mensual, IMSS no | 15,000.00 | **13,597.18** |
| Semanal | 3,500.00 | **3,076.67** |
| Quincenal | 7,500.00 | **6,592.87** |

En el caso mensual de 15,000.00, la referencia mensual supera el límite del subsidio; por eso el ISR retenido es el ISR por tarifa completo.

## Flujo inverso

Política: `standard-net-to-gross-2026-certified-intervals-v1`.

El inverso recibe un **neto objetivo positivo** y no pide un bruto inicial. Busca centavos de bruto en intervalos disjuntos y ejecuta siempre el cálculo directo como autoridad.

```text
dominio técnico: 0.01 a 1,000,000,000.00 de bruto por periodo
presupuesto: 4096 evaluaciones y 3000 ms cooperativos
hoja: 128 centavos
cesión: cada 32 evaluaciones
```

El resultado separa:

- **Coincidencia exacta:** diferencia de cero centavos y resultado directo completo y reconciliado.
- **Aproximación:** candidatos por debajo y por encima, con distancia.
- **Ninguna:** no se encontró candidato en el dominio cubierto.
- **Cobertura:** completa, limitada o fiscalmente incompleta.
- **Presupuesto:** completado, agotado por evaluaciones, agotado por tiempo o cancelado.

La búsqueda no supone monotonía del neto. Usa un certificado de componentes revisados para cerrar intervalos cuando las condiciones se cumplen. Si no hay certificado, solo divide, enumera o devuelve incertidumbre; no inventa una conclusión.

Ejemplo: neto mensual 13,202.64 → bruto **15,000.00**. El inverso también puede devolver alternativas, por ejemplo neto semanal 3,076.67 → 3,499.99 y 3,500.00.

## Políticas y autoridades

| Política | Identificador |
| --- | --- |
| Decimal | `decimal-50-v1` |
| Convenciones generales | `standard-estimate-2026-v1` |
| Integración | `theoretical-fixed-integration-2026-v1` |
| SBC | `estimated-sbc-general-2026-half-up-v1` |
| IMSS obrero | `standard-worker-imss-general-2026-half-up-per-branch-v1` |
| ISR | `standard-isr-tariff-2026-final-half-up-v1` |
| Subsidio | `standard-employment-subsidy-2026-period-half-up-v1` |
| Retención | `standard-isr-withholding-2026-monthly-minimum-explicit-assumption-v1` |
| Bruto a neto | `standard-gross-to-net-2026-component-cent-reconciliation-v1` |
| Neto a bruto | `standard-net-to-gross-2026-certified-intervals-v1` |

Las convenciones generales declaran, entre otras cosas:

- `activation: "not-activated"`.
- `resultClassification: "estimated"`.
- `temporalScope: "effective-date-snapshot"`.
- `intervalInference: "no-calendar-interval-inferred"`.
- `monthlyAccumulation: "not-simulated"`.
- `geography: "general-zone"`.
- `fiscalRoundingApproval: "pending-operation-validation"`.
- `suaEquivalence: "not-validated"`.

## Parámetros fiscales

Los parámetros 2026 incluyen tarifas ISR semanal, quincenal y mensual; UMA; salario mínimo general; subsidio; constantes IMSS y fuentes oficiales. Cada conjunto conserva vigencia, versión, autoridad, fuente, fecha de publicación o verificación y estado de validación.

El paquete fuente 2026 es `mx-fiscal-2026-source-v3`, con SHA-256:

```text
7e9f13084e64633b29959d79eec5f9c02333fe2695809c662d71fa7fc8393ab0
```

La huella del motor es:

```text
payroll-js-sha256:4f90d957a9948f8a90c661ccbe1f59ea5afd3a6e56df341f4318570e1985a842
```

## Advertencias que deben permanecer visibles

- `STANDARD_RESULT_NOT_CERTIFIED`
- `ESTIMATED_MONTHLY_REFERENCE`
- `MONTHLY_SUBSIDY_RECONCILIATION_NOT_SIMULATED`
- `EMPLOYER_ELECTION_NOT_EVALUATED`
- `PROVISIONAL_ISR_AFTER_SUBSIDY`
- `SUBSIDY_EXCESS_NOT_PAID_OR_CARRIED`
- `NOT_FINAL_ISR_WITHHOLDING`
- `MINIMUM_WAGE_WITHHOLDING_EXCEPTION_NOT_EVALUATED`
- `CONTRACTUAL_DAILY_SALARY_BELOW_GENERAL_MINIMUM`
- `MONTHLY_MINIMUM_CONDITION_ASSUMED`

Una advertencia no es decoración: cambia la interpretación del resultado. Por ejemplo, un neto calculado con una hipótesis mensual no acredita que la retención sea legalmente exigible.

## Límites

- Solo 2026 y zona general.
- Solo salario ordinario fijo totalmente gravado.
- Sin ingresos variables, exentos, incidencias u otros patrones.
- Sin conciliación mensual real.
- Sin CFDI, SUA ni CONTPAQi.
- Sin IMSS manual, pago fiscal diario independiente ni 2027.
- Sin SBC mixto ni días cotizados reales.
- El inverso solo demuestra resultados dentro del dominio y la cobertura informados.
- Los redondeos son convenciones versionadas, no resultados certificados por una autoridad.

## Dónde mirar el código

- `src/domain/payroll/money.ts`
- `src/domain/payroll/salary-integration.ts`
- `src/domain/payroll/sbc.ts`
- `src/domain/payroll/worker-imss.ts`
- `src/domain/payroll/isr-tariff.ts`
- `src/domain/payroll/employment-subsidy.ts`
- `src/domain/payroll/gross-to-net.ts`
- `src/domain/payroll/net-to-gross.ts`
- `src/domain/payroll/net-to-gross-certificate.ts`
- `src/domain/payroll/simulation-conventions.ts`
- `src/tests/fixtures/isr-2026.expected.csv`

La arquitectura que conecta estas piezas con la interfaz y la persistencia está en [ARQUITECTURA.md](ARQUITECTURA.md).
