/**
 * The only module in this app that imports from `echarts`.
 *
 * `import * as echarts from 'echarts'` pulls the whole library — every chart type, every
 * component — into the bundle. Registering exactly what is used keeps it to the scatter and
 * line this app draws, and funnelling every import through one file makes the cost of adding
 * a chart type visible as a one-line diff here rather than invisible in a page component.
 */

import * as echarts from 'echarts/core'
import { LineChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  CanvasRenderer,
])

export { echarts }
