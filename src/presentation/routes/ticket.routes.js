const express = require('express');
const ticketController = require('../controllers/ticket.controller');
const authMiddleware = require('../middleware/auth.middleware');
const adminOnly = require('../middleware/adminOnly.middleware');
const ticketUpload = require('../../utils/ticketUpload.multer');

const router = express.Router();

router.post('/', authMiddleware, ticketUpload.array('attachments', 5), ticketController.createTicket);
router.get('/', authMiddleware, ticketController.listTickets);
router.get('/:id', authMiddleware, ticketController.getTicket);
router.get('/:id/messages', authMiddleware, ticketController.listMessages);
router.post('/:id/messages', authMiddleware, ticketUpload.array('attachments', 5), ticketController.createMessage);
router.patch('/:id/status', authMiddleware, ticketController.updateTicketStatus);
router.patch('/:id/assign', authMiddleware, adminOnly, ticketController.assignTicket);
router.post('/:id/take', authMiddleware, ticketController.takeTicket);

module.exports = router;
