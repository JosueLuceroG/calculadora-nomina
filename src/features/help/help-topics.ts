import { initialBenefits } from "../calculator/form"
import { getParameterCatalog2026 } from "../parameters/parameter-catalog"
import type { ParameterCategory } from "../parameters/parameter-section"

export type HelpTopic = Readonly<{ id: string; title: string; paragraphs: readonly string[]; formula?: string; parameters: readonly ParameterCategory[] }>

/** Texto explicativo y referencias al catálogo existente, sin reglas ejecutables. */
export function getHelpTopics(): readonly HelpTopic[] {
  const catalog = getParameterCatalog2026()
  const days = catalog.contractualDivisors[0].data
  return [
    { id: "gross", title: "Bruto a Neto", paragraphs: [
      "El bruto es el salario antes de descuentos. La aplicación parte de ese importe para estimar cuánto recibe el trabajador.",
      "El subsidio al empleo se considera al determinar el ISR efectivamente retenido. Si ya redujo ese ISR, no debe sumarse otra vez al neto.",
    ], formula: "Neto = Bruto − ISR efectivamente retenido − IMSS efectivamente descontado.", parameters: ["isr", "subsidy", "imss"] },
    { id: "inverse", title: "Neto a Bruto y alternativas", paragraphs: [
      "Indicas el neto que deseas recibir y la aplicación busca brutos que lo produzcan, verificándolos con el mismo cálculo de Bruto a Neto.",
      "Los redondeos a centavos y los saltos de tarifas o subsidio pueden permitir varias soluciones. El desglose corresponde al bruto recomendado; una alternativa informativa no lo sustituye.",
    ], parameters: ["policies"] },
    { id: "isr", title: "Cómo se determina el ISR", paragraphs: [
      "El ingreso gravado se ubica en un tramo de la tarifa. Se resta el límite inferior, se aplica el porcentaje al excedente y se agrega la cuota fija de ese tramo.",
      "ISR por tarifa es el importe antes del subsidio y de las condiciones de retención. El subsidio aplicado reduce el ISR cuando corresponde; el ISR retenido es lo que finalmente se descuenta en la simulación. No son tres descuentos distintos.",
    ], formula: "ISR por tarifa = cuota fija + (ingreso gravado − límite inferior) × porcentaje / 100.", parameters: ["isr", "subsidy"] },
    { id: "imss", title: "IMSS: calculado, descontado y absorbido", paragraphs: [
      "La cuota obrera se estima con el SBC y las tasas de los ramos incluidos en el perfil. La cuota calculada puede ser distinta de la efectivamente descontada.",
      "Cuando aplica la absorción del artículo 36 de la Ley del Seguro Social, el patrón absorbe la cuota obrera y no se descuenta al trabajador.",
      "Elegir IMSS No elimina el descuento únicamente en esta simulación; no constituye una exención legal. La absorción legal se conserva cuando corresponde.",
      "El descuento disponible se estima automáticamente. La captura manual de una cuota no está habilitada para ninguno de los dos sentidos de cálculo.",
    ], parameters: ["imss"] },
    { id: "integration", title: "Salario diario, FI, SDI y SBC", paragraphs: [
      `Salario diario: salario del periodo dividido entre los días estándar del perfil (${days.weekly}, ${days.fortnightly} o ${days.monthly}). No son necesariamente los días realmente cotizados.`,
      "El salario diario de referencia del desglose se deriva del bruto calculado: se divide entre 7, 15 o 30 y se redondea a centavos. El mes utiliza una convención de 30 días. Es informativo: no calcula ISR diario ni sustituye el SBC o el SDI.",
      "FI significa factor de integración: expresa cómo el aguinaldo y la prima de vacaciones declarados incrementan teóricamente el salario diario. El salario ordinario de vacaciones ya está incluido; su prima se integra sin volver a contar ese salario.",
      "SDI teórico es el salario diario integrado con ese factor. El SBC estimado aplica los límites de referencia correspondientes. Ninguno acredita el SBC efectivamente registrado ante el IMSS.",
    ], parameters: ["uma", "imss", "benefits"] },
    { id: "benefits", title: "Por qué aparecen prestaciones iniciales", paragraphs: [
      `La captura comienza con ${initialBenefits.bonusDays} días de aguinaldo, ${initialBenefits.vacationDays} días de vacaciones y ${initialBenefits.vacationPremium}% de prima vacacional como punto de partida editable.`,
      "Debes ajustar esos valores según la antigüedad y las prestaciones correspondientes. Los 12 días de vacaciones son una referencia de primer derecho anual, no un valor universal para todos los trabajadores. La aplicación no infiere la antigüedad.",
    ], parameters: ["benefits"] },
    { id: "date", title: "Fecha de referencia fiscal", paragraphs: [
      "Al preparar una simulación se utiliza automáticamente la fecha civil local del equipo para seleccionar los parámetros aplicables. Esa referencia no necesariamente es la fecha de pago.",
      "Activa Elegir otra fecha: Sí para mostrar el calendario. Volver a No resuelve la fecha local actual. Editar datos conserva la referencia de la captura; Limpiar prepara una sesión nueva.",
      "La Fecha de pago es opcional e informativa: no selecciona tablas ni reemplaza la referencia fiscal. Solo se conserva durante esta sesión, no se guarda en Historial ni se exporta al PDF; Limpiar la elimina.",
      `La cobertura disponible es ${catalog.exercise}. Un ejercicio sin paquete compatible, como 2027, queda bloqueado: no puede calcularse usando automáticamente las reglas 2026. Consultar Ayuda o Parámetros no cambia la fecha de tu cálculo.`,
    ], parameters: ["uma", "subsidy", "isr"] },
    { id: "zone", title: "Zona salarial", paragraphs: [
      "Esta versión calcula únicamente en Zona general. La Zona Libre de la Frontera Norte no está soportada para cálculos, aunque Parámetros permita verla como referencia informativa.",
    ], parameters: ["minimum"] },
    { id: "minimum", title: "Salario mínimo y condición mensual", paragraphs: [
      "El mínimo diario, su equivalente de 30 días y la expresión mensual CONASAMI son referencias distintas. La política contextual v2 precisa la base salarial; la región mensual de análisis no es un nuevo piso legal ni un bloqueo por importe.",
      "La no retención del artículo 96 no es una excepción automática por igualar una cifra diaria o mensual. Requiere la condición de percibir únicamente salario mínimo general en el mes. La confirmación del usuario es una hipótesis de simulación; no verifica todas las percepciones reales del mes.",
      "Si se declara salario diario pactado para los días estándar, se puede resolver el tratamiento ordinario o una hipótesis compatible de mínimo. Si falta base mensual, ISR retenido y neto quedan no determinados; pagos por días reales 28/30/31 u otros hechos mensuales están fuera del perfil.",
    ], parameters: ["minimum"] },
    { id: "limits", title: "Alcance y limitaciones", paragraphs: [
      "El pago diario independiente y la cobertura 2027 no están habilitados. El salario diario de referencia del desglose no habilita ISR ni neto diarios.",
      `Se simula salario ordinario fijo completamente gravado, con periodos estándar de ${days.weekly}/${days.fortnightly}/${days.monthly} días y prestaciones declaradas. El SBC es estimado.`,
      "No se reconstruyen incidencias, faltas, incapacidades, movimientos, ingresos exentos o variables, otros pagos, varios patrones, acumulados ni conciliación del calendario real.",
      "El resultado no está homologado operativamente con SUA ni CONTPAQi Nóminas. No sustituye un CFDI, una liquidación de nómina real ni un cálculo oficial certificado. — significa no determinado, no cero.",
    ], parameters: ["policies"] },
  ]
}

export const inverseHelpStates = [
  { label: "Exacto", text: "El neto obtenido coincide a centavos con el solicitado para el candidato verificado." },
  { label: "Aproximado", text: "El neto obtenido difiere del solicitado. Revisa la diferencia; no se garantiza la mejor aproximación global." },
  { label: "Bruto encontrado", text: "Se verificó el candidato, pero no se demostró que sea el menor. Puede existir un bruto menor." },
  { label: "Mínimo demostrado en el dominio analizado", text: "Existe esa demostración únicamente dentro del rango analizado y según el certificado del reporte; no se promete un mínimo global." },
  { label: "Búsqueda limitada", text: "No se ha certificado toda la cobertura requerida. Puede conservar candidatos verificados e incluso una prueba de mínimo local; no implica que se hayan encontrado todas las soluciones." },
  { label: "No determinable", text: "Los datos, las condiciones fiscales o la búsqueda no permiten determinar un resultado. No equivale a cero ni demuestra por sí solo que no exista solución." },
] as const
