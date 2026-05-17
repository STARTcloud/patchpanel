// Side-effect setup for @highcharts/react v5: registers a custom Highcharts
// instance globally so every <Chart>/<MapsChart> in the app uses the same
// instance with accessibility enabled. Consumers `import './Highcharts.jsx'`
// once — no default export, the file is loaded for its setHighcharts() side
// effect only.
//
// Maps support is handled directly by <MapsChart> from @highcharts/react/Maps;
// no separate `highcharts/modules/map` import is needed.
import { setHighcharts } from '@highcharts/react';
import Highcharts from 'highcharts/highcharts';
import 'highcharts/es-modules/masters/modules/accessibility.src.js';

setHighcharts(Highcharts);
