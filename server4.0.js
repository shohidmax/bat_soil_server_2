const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { MongoClient, ServerApiVersion } = require('mongodb');
const path = require('path');
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

    // --- ADMIN ROUTE ---
    app.get('/admin', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'admin.html'));
    });

    // --- API: Toggle Device Visibility (Admin) ---
    app.post('/api/admin/toggle-visibility', async (req, res) => {
        const { uid, isHidden } = req.body;
        try {
            await DeviceMetaCollection.updateOne(
                { uid }, 
                { $set: { uid, isHidden: isHidden } }, 
                { upsert: true }
            );
            io.emit('visibility-updated', { uid, isHidden }); // Notify clients
            res.send({ success: true });
        } catch (e) { res.status(500).send({ error: "Failed" }); }
    });

    // --- API: Get Device Metadata (Names & Visibility) ---
    app.get('/api/device-metadata', async (req, res) => {
      try {
        const docs = await DeviceMetaCollection.find({}).toArray();
        const metaMap = {};
        docs.forEach(doc => { 
            metaMap[doc.uid] = { name: doc.name, isHidden: doc.isHidden }; 
        });
        res.send(metaMap);
      } catch (err) { res.status(500).send({ error: "Error fetching metadata" }); }
    });
    
    // Legacy support for name only
    app.get('/api/device-names', async (req, res) => {
        const docs = await DeviceMetaCollection.find({}).toArray();
        const nameMap = {};
        docs.forEach(doc => { nameMap[doc.uid] = doc.name; });
        res.send(nameMap);
    });

    // --- API: Save Name ---
    app.post('/api/device-name', async (req, res) => {
      try {
        const { uid, name } = req.body;
        await DeviceMetaCollection.updateOne({ uid }, { $set: { uid, name } }, { upsert: true });
        io.emit('name-updated', { uid, name });
        res.send({ success: true });
      } catch (err) { res.status(500).send({ error: "Error saving name" }); }
    });

    // --- Command API ---
    app.post('/api/send-command', (req, res) => {
      const { uid, command, value } = req.body;
      if (!pendingCommands[uid]) pendingCommands[uid] = {};

      if (command === 'restart') pendingCommands[uid].command = 'restart';
      else if (command === 'setDry') pendingCommands[uid].setDry = parseInt(value);
      else if (command === 'setWet') pendingCommands[uid].setWet = parseInt(value);
      else if (command === 'setInterval') pendingCommands[uid].setInterval = parseInt(value);

      console.log(`Command queued for ${uid}`);
      res.send({ success: true, message: "Command queued" });
    });

    // --- Sensor Data API ---
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

    app.get('/api/esp32', async(req, res) =>{
      const cursor = EspCollection.find({}).sort({_id: -1}).limit(500);
      const Data = await cursor.toArray();
      res.send(Data);
    });

    // Report API
    app.get('/api/report', async (req, res) => {
      try {
        const { uid, startDate, endDate } = req.query;
        let query = {};
        if (uid) query.uid = uid;
        if (startDate && endDate) {
            query.dateTime = { $gte: startDate.replace('T', ' ') + ":00", $lte: endDate.replace('T', ' ') + ":59" };
        }
        const data = await EspCollection.find(query).sort({ _id: -1 }).toArray();
        res.send(data);
      } catch (err) { res.status(500).send({ error: "Failed" }); }
    });

    app.get("/", (req, res) => res.send("Server Running v3.0"));

  } finally {}
}
run().catch(console.dir); 

http.listen(port, () => console.log(`Server running on port ${port}`));