const clients = new Set();

function writeEvent(res, event, data) {
  if (res.writableEnded) return false;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  return true;
}

function addClient(res) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

function removeClient(res) {
  clients.delete(res);
}

function broadcast(event, data) {
  for (const client of clients) {
    if (!writeEvent(client, event, data)) clients.delete(client);
  }
}

function heartbeat() {
  for (const client of clients) {
    if (!writeEvent(client, 'heartbeat', { timestamp: Date.now() })) clients.delete(client);
  }
}

function count() {
  return clients.size;
}

module.exports = { addClient, removeClient, writeEvent, broadcast, heartbeat, count };
