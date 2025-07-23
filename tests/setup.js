// Configuración global para tests
require('dotenv').config({ path: '.env' });

// Mock del logger para evitar logs durante tests
jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

// Configurar timeout global para requests HTTP
jest.setTimeout(30000);
