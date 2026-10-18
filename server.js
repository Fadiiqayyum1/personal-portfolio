const express = require('express');
const session = require('express-session');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const multer = require('multer');

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Static folder for uploaded images
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
app.use('/uploads', express.static(uploadDir));

// Multer Storage Setup for Notifications Image
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// --- MONGODB OR LOCAL JSON DATABASE SETUP ---
let useMongoDB = false;

if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI)
        .then(() => {
            console.log('Successfully connected to MongoDB Database!');
            useMongoDB = true;
        })
        .catch(err => console.log('MongoDB Connection Error (Falling back to JSON DB):', err.message));
}

// Mongo Schemas
const NotifSchema = new mongoose.Schema({ title: String, desc: String, image: String, createdAt: { type: Date, default: Date.now } });
const CourseSchema = new mongoose.Schema({ title: String, cat: String, desc: String, createdAt: { type: Date, default: Date.now } });
const NoteSchema = new mongoose.Schema({ title: String, link: String, size: String, createdAt: { type: Date, default: Date.now } });
const ContactSchema = new mongoose.Schema({ name: String, email: String, message: String, createdAt: { type: Date, default: Date.now } });

const NotifModel = mongoose.model('Notification', NotifSchema);
const CourseModel = mongoose.model('Course', CourseSchema);
const NoteModel = mongoose.model('Note', NoteSchema);
const ContactModel = mongoose.model('ContactMessage', ContactSchema);

// Fallback JSON DB File
const DB_FILE = path.join(__dirname, 'database.json');
if (!fs.existsSync(DB_FILE)) {
    const initialData = {
        notifications: [
            { id: 1, title: 'AI Assignment Solutions Available', desc: 'Artificial Intelligence assignment solutions and study notes uploaded.', image: '' }
        ],
        courses: [
            { id: 1, title: 'HTML, CSS & JavaScript Fundamentals', cat: 'Web Development', desc: 'Zero se responsive websites banana sikhein Tailwind CSS ke sath.' },
            { id: 2, title: 'AI & Machine Learning Basics', cat: 'Artificial Intelligence', desc: 'Russell & Norvig Book par mabni AI concepts aur problem sets.' }
        ],
        notes: [
            { id: 1, title: 'AI Formal Definitions Notes', link: '#', size: '2.4 MB' }
        ],
        messages: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
}

const readDB = () => {
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!data.messages) data.messages = [];
    return data;
};
const writeDB = (data) => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

// Auth Middleware
const requireAuth = (req, res, next) => {
    if (req.session && req.session.isAdmin) {
        return next();
    }
    res.status(403).json({ success: false, message: 'Unauthorized! Pehle Login karein.' });
};

// --- ROUTES ---

// Get Data
app.get('/api/data', async (req, res) => {
    let messages = [];
    if (useMongoDB) {
        try {
            const notifications = await NotifModel.find().sort({ createdAt: -1 });
            const courses = await CourseModel.find().sort({ createdAt: -1 });
            const notes = await NoteModel.find().sort({ createdAt: -1 });
            if (req.session.isAdmin) {
                messages = await ContactModel.find().sort({ createdAt: -1 });
            }
            return res.json({
                data: {
                    notifications: notifications.map(n => ({ id: n._id, title: n.title, desc: n.desc, image: n.image })),
                    courses: courses.map(c => ({ id: c._id, title: c.title, cat: c.cat, desc: c.desc })),
                    notes: notes.map(o => ({ id: o._id, title: o.title, link: o.link, size: o.size })),
                    messages: messages.map(m => ({ id: m._id, name: m.name, email: m.email, message: m.message, date: m.createdAt }))
                },
                isAdmin: req.session.isAdmin || false
            });
        } catch (e) {
            console.error(e);
        }
    }
    const db = readDB();
    res.json({ 
        data: {
            ...db,
            messages: req.session.isAdmin ? db.messages : []
        }, 
        isAdmin: req.session.isAdmin || false 
    });
});

// Admin Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const envUser = process.env.ADMIN_USERNAME || 'fahad';
    const envPass = process.env.ADMIN_PASSWORD || 'secure_fahad_123';

    if (username === envUser && password === envPass) {
        req.session.isAdmin = true;
        return res.json({ success: true, message: 'Login Successful!' });
    }
    res.status(401).json({ success: false, message: 'Ghalat Username ya Password!' });
});

// Admin Logout
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true, message: 'Logged out successfully.' });
});

// Notification Routes (Supports Image Upload via Multer)
app.post('/api/notification', requireAuth, upload.single('image'), async (req, res) => {
    const { title, desc } = req.body;
    const imagePath = req.file ? `/uploads/${req.file.filename}` : '';

    if (useMongoDB) {
        const item = await NotifModel.create({ title, desc, image: imagePath });
        return res.json({ success: true, item: { id: item._id, title, desc, image: imagePath } });
    }
    const db = readDB();
    const newItem = { id: Date.now(), title, desc, image: imagePath };
    db.notifications.unshift(newItem);
    writeDB(db);
    res.json({ success: true, item: newItem });
});

app.delete('/api/notification/:id', requireAuth, async (req, res) => {
    if (useMongoDB) {
        await NotifModel.findByIdAndDelete(req.params.id);
        return res.json({ success: true });
    }
    const db = readDB();
    db.notifications = db.notifications.filter(n => n.id != req.params.id);
    writeDB(db);
    res.json({ success: true });
});

// Course Routes
app.post('/api/course', requireAuth, async (req, res) => {
    const { title, cat, desc } = req.body;
    if (useMongoDB) {
        const item = await CourseModel.create({ title, cat, desc });
        return res.json({ success: true, item: { id: item._id, title, cat, desc } });
    }
    const db = readDB();
    const newItem = { id: Date.now(), title, cat, desc };
    db.courses.unshift(newItem);
    writeDB(db);
    res.json({ success: true, item: newItem });
});

app.delete('/api/course/:id', requireAuth, async (req, res) => {
    if (useMongoDB) {
        await CourseModel.findByIdAndDelete(req.params.id);
        return res.json({ success: true });
    }
    const db = readDB();
    db.courses = db.courses.filter(c => c.id != req.params.id);
    writeDB(db);
    res.json({ success: true });
});

// Note Routes
app.post('/api/note', requireAuth, async (req, res) => {
    const { title, link, size } = req.body;
    if (useMongoDB) {
        const item = await NoteModel.create({ title, link, size: size || 'PDF' });
        return res.json({ success: true, item: { id: item._id, title, link, size } });
    }
    const db = readDB();
    const newItem = { id: Date.now(), title, link, size: size || 'PDF' };
    db.notes.unshift(newItem);
    writeDB(db);
    res.json({ success: true, item: newItem });
});

app.delete('/api/note/:id', requireAuth, async (req, res) => {
    if (useMongoDB) {
        await NoteModel.findByIdAndDelete(req.params.id);
        return res.json({ success: true });
    }
    const db = readDB();
    db.notes = db.notes.filter(n => n.id != req.params.id);
    writeDB(db);
    res.json({ success: true });
});

// Delete Message Route
app.delete('/api/message/:id', requireAuth, async (req, res) => {
    if (useMongoDB) {
        await ContactModel.findByIdAndDelete(req.params.id);
        return res.json({ success: true });
    }
    const db = readDB();
    db.messages = db.messages.filter(m => m.id != req.params.id);
    writeDB(db);
    res.json({ success: true });
});

// CSV Export Route
app.get('/api/export-messages-csv', requireAuth, async (req, res) => {
    let messages = [];
    if (useMongoDB) {
        messages = await ContactModel.find().sort({ createdAt: -1 });
    } else {
        messages = readDB().messages;
    }

    let csvContent = "Name,Email,Message,Date\n";
    messages.forEach(m => {
        const name = `"${(m.name || '').replace(/"/g, '""')}"`;
        const email = `"${(m.email || '').replace(/"/g, '""')}"`;
        const msg = `"${(m.message || '').replace(/"/g, '""')}"`;
        const date = `"${new Date(m.createdAt || m.date || Date.now()).toLocaleString()}"`;
        csvContent += `${name},${email},${msg},${date}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="contact_messages.csv"');
    res.status(200).send(csvContent);
});

// --- CONTACT FORM ROUTE (Nodemailer + DB Save) ---
app.post('/api/contact', async (req, res) => {
    const { name, email, message } = req.body;

    if (useMongoDB) {
        try {
            await ContactModel.create({ name, email, message });
        } catch (dbErr) {
            console.error('Database Save Error:', dbErr);
        }
    } else {
        const db = readDB();
        db.messages.unshift({ id: Date.now(), name, email, message, date: new Date() });
        writeDB(db);
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASS
        }
    });

    const mailOptions = {
        from: process.env.GMAIL_USER,
        to: process.env.GMAIL_USER,
        replyTo: email,
        subject: `New Portfolio Contact Message from ${name}`,
        text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Contact email sent successfully & saved to DB!');
        res.json({ success: true, message: 'Message sent successfully!' });
    } catch (error) {
        console.error('Nodemailer Error:', error);
        res.json({ success: true, message: 'Saved to Database! (Email service temporarily offline).' });
    }
});

// --- DIRECT EMAIL REPLY ROUTE (Sent from Admin Panel) ---
app.post('/api/reply', requireAuth, async (req, res) => {
    const { toEmail, toName, replyMessage } = req.body;

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASS
        }
    });

    const mailOptions = {
        from: process.env.GMAIL_USER,
        to: toEmail,
        subject: `Reply from Fahad Qayyum - Portfolio`,
        text: `Hello ${toName},\n\n${replyMessage}\n\nBest Regards,\nFahad Qayyum`
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Reply sent successfully to ${toEmail}`);
        res.json({ success: true, message: 'Reply sent successfully!' });
    } catch (error) {
        console.error('Reply Email Error:', error);
        res.status(500).json({ success: false, message: 'Failed to send reply email.' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running securely on http://localhost:${PORT}`);
});