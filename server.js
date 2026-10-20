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

// Increased body size limit to 10mb for Vercel Base64 uploads
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Static folder setup (Safe for Vercel /tmp or local)
const uploadDir = path.join('/tmp', 'uploads');
try {
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }
} catch (e) {
    console.log('Upload dir creation skipped on read-only fs');
}
app.use('/uploads', express.static(uploadDir));

// Multer Memory Storage Setup for Vercel serverless environment
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Vercel Serverless Optimized Session Configuration
app.set('trust proxy', 1); // Trust Vercel's proxy
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret_key',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // true on production (HTTPS)
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 1 Day
    }
}));

// --- MONGODB ATLAS SETUP (Optimized for Serverless) ---
let isConnected = false;

async function connectDB() {
    if (isConnected) return;
    if (process.env.MONGO_URI) {
        try {
            const db = await mongoose.connect(process.env.MONGO_URI, {
                serverSelectionTimeoutMS: 5000
            });
            isConnected = db.connections[0].readyState;
            console.log('Successfully connected to MongoDB Database!');
        } catch (err) {
            console.log('MongoDB Connection Error:', err.message);
        }
    }
}

// Connect database on middleware level for serverless safety
app.use(async (req, res, next) => {
    await connectDB();
    next();
});

// Mongo Schemas
const NotifSchema = new mongoose.Schema({ title: String, desc: String, image: String, createdAt: { type: Date, default: Date.now } });
const CourseSchema = new mongoose.Schema({ title: String, cat: String, desc: String, image: String, createdAt: { type: Date, default: Date.now } });
const NoteSchema = new mongoose.Schema({ title: String, link: String, size: String, createdAt: { type: Date, default: Date.now } });
const ContactSchema = new mongoose.Schema({ name: String, email: String, message: String, createdAt: { type: Date, default: Date.now } });

const NotifModel = mongoose.models.Notification || mongoose.model('Notification', NotifSchema);
const CourseModel = mongoose.models.Course || mongoose.model('Course', CourseSchema);
const NoteModel = mongoose.models.Note || mongoose.model('Note', NoteSchema);
const ContactModel = mongoose.models.ContactMessage || mongoose.model('ContactMessage', ContactSchema);

// Auth Middleware
const requireAuth = (req, res, next) => {
    if (req.session && req.session.isAdmin) {
        return next();
    }
    res.status(403).json({ success: false, message: 'Unauthorized! Pehle Login karein.' });
};

// --- ROUTES ---

app.get('/api/data', async (req, res) => {
    let messages = [];
    try {
        const notifications = await NotifModel.find().sort({ _id: -1 }).lean();
        const courses = await CourseModel.find().sort({ _id: -1 }).lean();
        const notes = await NoteModel.find().sort({ _id: -1 }).lean();
        
        if (req.session && req.session.isAdmin) {
            messages = await ContactModel.find().sort({ _id: -1 }).lean();
        }

        return res.json({
            data: {
                notifications: notifications.map(n => ({ id: n._id, title: n.title, desc: n.desc, image: n.image })),
                courses: courses.map(c => ({ id: c._id, title: c.title, cat: c.cat, desc: c.desc, image: c.image })),
                notes: notes.map(o => ({ id: o._id, title: o.title, link: o.link, size: o.size })),
                messages: messages.map(m => ({ id: m._id, name: m.name, email: m.email, message: m.message, date: m.createdAt }))
            },
            isAdmin: (req.session && req.session.isAdmin) || false
        });
    } catch (e) {
        console.error("Data Fetch Error:", e);
        res.status(500).json({ success: false, message: 'Database Error' });
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const envUser = process.env.ADMIN_USERNAME || 'fahad';
    const envPass = process.env.ADMIN_PASSWORD || 'secure_fahad_123';

    if (username === envUser && password === envPass) {
        req.session.isAdmin = true;
        // Explicitly save session before responding to ensure Vercel records it
        req.session.save((err) => {
            if (err) {
                console.error("Session Save Error:", err);
                return res.status(500).json({ success: false, message: 'Session error' });
            }
            return res.json({ success: true, message: 'Login Successful!' });
        });
    } else {
        res.status(401).json({ success: false, message: 'Ghalat Username ya Password!' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true, message: 'Logged out successfully.' });
    });
});

app.post('/api/notification', requireAuth, upload.single('image'), async (req, res) => {
    const { title, desc } = req.body;
    let imagePath = '';

    if (req.file) {
        const mimeType = req.file.mimetype || 'image/png';
        imagePath = `data:${mimeType};base64,${req.file.buffer.toString('base64')}`;
    }

    try {
        const item = await NotifModel.create({ title, desc, image: imagePath });
        res.json({ success: true, item: { id: item._id, title, desc, image: imagePath } });
    } catch (err) {
        console.error('Notification Save Error:', err);
        res.status(500).json({ success: false, message: 'Failed to save notification' });
    }
});

app.delete('/api/notification/:id', requireAuth, async (req, res) => {
    await NotifModel.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

app.post('/api/course', requireAuth, upload.single('image'), async (req, res) => {
    const { title, cat, desc } = req.body;
    let imagePath = '';

    if (req.file) {
        const mimeType = req.file.mimetype || 'image/png';
        imagePath = `data:${mimeType};base64,${req.file.buffer.toString('base64')}`;
    }

    try {
        const item = await CourseModel.create({ title, cat, desc, image: imagePath });
        res.json({ success: true, item: { id: item._id, title, cat, desc, image: imagePath } });
    } catch (err) {
        console.error('Course Save Error:', err);
        res.status(500).json({ success: false, message: 'Failed to save course' });
    }
});

app.delete('/api/course/:id', requireAuth, async (req, res) => {
    await CourseModel.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

app.post('/api/note', requireAuth, upload.single('file'), async (req, res) => {
    const { title, size } = req.body;
    let fileLink = '';

    if (req.file) {
        const mimeType = req.file.mimetype || 'application/pdf';
        fileLink = `data:${mimeType};base64,${req.file.buffer.toString('base64')}`;
    }

    try {
        const item = await NoteModel.create({ title, link: fileLink, size: size || 'PDF Document' });
        res.json({ success: true, item: { id: item._id, title, link: fileLink, size } });
    } catch (err) {
        console.error('Note Save Error:', err);
        res.status(500).json({ success: false, message: 'Failed to upload note file' });
    }
});

app.delete('/api/note/:id', requireAuth, async (req, res) => {
    await NoteModel.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

app.delete('/api/message/:id', requireAuth, async (req, res) => {
    await ContactModel.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

app.get('/api/export-messages-csv', requireAuth, async (req, res) => {
    const messages = await ContactModel.find().sort({ _id: -1 }).lean();
    let csvContent = "Name,Email,Message,Date\n";
    messages.forEach(m => {
        const name = `"${(m.name || '').replace(/"/g, '""')}"`;
        const email = `"${(m.email || '').replace(/"/g, '""')}"`;
        const msg = `"${(m.message || '').replace(/"/g, '""')}"`;
        const date = `"${new Date(m.createdAt || Date.now()).toLocaleString()}"`;
        csvContent += `${name},${email},${msg},${date}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="contact_messages.csv"');
    res.status(200).send(csvContent);
});

app.post('/api/contact', async (req, res) => {
    const { name, email, message } = req.body;
    try {
        await ContactModel.create({ name, email, message });
    } catch (dbErr) {
        console.error('Database Save Error:', dbErr);
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
        res.json({ success: true, message: 'Message sent successfully!' });
    } catch (error) {
        console.error('Nodemailer Error:', error);
        res.json({ success: true, message: 'Saved to Database!' });
    }
});

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
        res.json({ success: true, message: 'Reply sent successfully!' });
    } catch (error) {
        console.error('Reply Email Error:', error);
        res.status(500).json({ success: false, message: 'Failed to send reply email.' });
    }
});

// Local listen check
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server running securely on http://localhost:${PORT}`);
    });
}

module.exports = app;