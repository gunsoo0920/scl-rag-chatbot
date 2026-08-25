import { createVercelHandler } from '../../server/vercelAdapter.js';

export const config = { maxDuration: 30 };

export default createVercelHandler('/api/chatbot/interpret');
