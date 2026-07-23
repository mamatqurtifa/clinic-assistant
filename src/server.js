const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Clinic Calendar Proxy jalan di http://localhost:${PORT}`);
});
