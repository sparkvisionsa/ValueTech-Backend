const request = require('supertest');
const express = require('express');
const authRoutes = require('../src/presentation/routes/auth.routes');
const packageRoutes = require('../src/presentation/routes/package.routes');
const { connect, mongoose } = require('../src/infrastructure/connect');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/packages', packageRoutes);

beforeAll(async () => {
    await connect();
    await mongoose.connection.db.dropDatabase(); // Clean DB for tests
});
afterAll(async () => {
    await mongoose.disconnect();
});

describe('User API', () => {
    it('should register a new user', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ phone: '1234567890', password: 'testpass', type: 'individual' });
        expect(res.statusCode).toBe(201);
        expect(res.body.message).toBe('User registered successfully.');
    });

    it('should not register duplicate user', async () => {
        await request(app)
            .post('/api/auth/register')
            .send({ phone: '1234567890', password: 'testpass', type: 'individual' });
        const res = await request(app)
            .post('/api/auth/register')
            .send({ phone: '1234567890', password: 'testpass', type: 'individual' });
        expect(res.statusCode).toBe(409);
    });

    it('should login user', async () => {
        await request(app)
            .post('/api/auth/register')
            .send({ phone: '0987654321', password: 'testpass', type: 'company' });
        const res = await request(app)
            .post('/api/auth/login')
            .send({ phone: '0987654321', password: 'testpass' });
        expect(res.statusCode).toBe(200);
        expect(res.body.message).toBe('Login successful.');
    });
});

describe('Package API', () => {
    it('should get all packages (empty)', async () => {
        const res = await request(app).get('/api/packages');
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});
