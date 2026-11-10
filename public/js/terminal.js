const term = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  fontFamily: 'Consolas, "Courier New", monospace',
  theme: {
    background: '#1b1d23',
    foreground: '#e7e9ee'
  }
});
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('terminal'));
fitAddon.fit();

const RESIZE_PREFIX = '\u0000RESIZE:';
const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(`${protocol}://${location.host}/ws/terminal`);

ws.onopen = () => {
  sendResize();
};
ws.onmessage = (ev) => term.write(ev.data);
ws.onclose = () => term.write('\r\n[connection closed]\r\n');

term.onData((data) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(data);
});

function sendResize() {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(`${RESIZE_PREFIX}${JSON.stringify({ cols: term.cols, rows: term.rows })}`);
}

window.addEventListener('resize', () => {
  fitAddon.fit();
  sendResize();
});
