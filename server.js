const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();

const app = express();
const http = require('http').createServer(app);

const io = require('socket.io')(http, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const uri = "mongodb+srv://atifsupermart202199:FGzi4j6kRnYTIyP9@cluster0.bfulggv.mongodb.net/?retryWrites=true&w=majority";
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

let pendingCommands = {};

io.on('connection', (socket) => {
  console.log('User connected via Socket.io');
});

async function run() {
  try {
    await client.connect();
    console.log('DB connected');
    
    const db = client.db('Esp32data4');
    const EspCollection = db.collection('espdata2');
    const DeviceMetaCollection = db.collection('device_metadata');

    // 1. Device Name API
    app.post('/api/device-name', async (req, res) => {
      try {
        const { uid, name } = req.body;
        await DeviceMetaCollection.updateOne({ uid }, { $set: { uid, name } }, { upsert: true });
        io.emit('name-updated', { uid, name });
        res.send({ success: true });
      } catch (err) { res.status(500).send({ error: "Error saving name" }); }
    });

    app.get('/api/device-names', async (req, res) => {
      try {
        const docs = await DeviceMetaCollection.find({}).toArray();
        const nameMap = {};
        docs.forEach(doc => { nameMap[doc.uid] = doc.name; });
        res.send(nameMap);
      } catch (err) { res.status(500).send({ error: "Error fetching names" }); }
    });

    // --- 2. [গুরুত্বপূর্ণ] Send Command API (Frontend calls this) ---
    app.post('/api/send-command', (req, res) => {
      const { uid, command, value } = req.body;
      if (!pendingCommands[uid]) pendingCommands[uid] = {};

      if (command === 'restart') {
        pendingCommands[uid].command = 'restart';
      } else if (command === 'setDry') {
        pendingCommands[uid].setDry = parseInt(value);
      } else if (command === 'setWet') {
        pendingCommands[uid].setWet = parseInt(value);
      } else if (command === 'setInterval') {
        pendingCommands[uid].setInterval = parseInt(value);
      }

      console.log(`Command queued for ${uid}:`, pendingCommands[uid]);
      
      // সকেট দিয়ে কনফার্মেশন পাঠানো (অপশনাল)
      io.emit('command-queued', { uid, command });
      
      res.send({ success: true, message: "Command queued" });
    });

    // --- 3. [গুরুত্বপূর্ণ] Sensor Data & Command Response API (ESP32 calls this) ---
    app.post('/api/esp32p', async (req, res) => {
      try {
        const sensorData = req.body;
        const uid = sensorData.uid;
        
        await EspCollection.insertOne(sensorData);
        io.emit('new-data', sensorData);

        let responsePayload = { status: "success" };
        if (uid && pendingCommands[uid]) {
          responsePayload = { ...responsePayload, ...pendingCommands[uid] };
          delete pendingCommands[uid];
        }
        res.json(responsePayload);
      } catch (err) { res.status(500).send("Server Error"); }
    });

    // --- 4. Recent Data API (Limited for Dashboard) ---
    app.get('/api/esp32', async(req, res) =>{
      const cursor = EspCollection.find({}).sort({_id: -1}).limit(500);
      const Data = await cursor.toArray();
      res.send(Data);
    });

    app.get("/", (req, res) => res.send("Server Running v2.0"));

  } finally {}
}
run().catch(console.dir);

http.listen(port, () => console.log(`Server running on port ${port}`));
