import pino from "pino";

import { env } from "../config/env";

export const logger: pino.Logger = pino({ level: env.LOG_LEVEL });
