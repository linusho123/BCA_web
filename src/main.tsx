import { render } from 'preact'
import { App } from './ui/App'
import './index.css'

const root = document.getElementById('app')
if (root === null) throw new Error('no #app element to render into')

render(<App />, root)
