import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { router } from './api/routes';
import { swaggerSpec } from './api/swagger';
import { globalLimiter } from './middleware/rate-limiter';
import { logger } from './logger';
import { config } from './config';

export const app = express();

app.use(express.json());
app.use(globalLimiter);

app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/api', router);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

if (require.main === module) {
  app.listen(config.port, () => {
    logger.info(`Server running on port ${config.port}`, { env: config.nodeEnv });
    logger.info(`API docs available at http://localhost:${config.port}/api/docs`);
  });
}
