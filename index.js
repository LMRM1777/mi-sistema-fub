import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ sistema: 'Mi Sistema FUB', estado: 'activo' });
});

app.get('/api/salud', (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor en puerto ${PORT}`);
});
