import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import whatsappRouter from "./whatsapp.js";
import adminRouter from "./admin.js";
import commandsRouter from "./commands.js";
import groupsRouter from "./groups.js";
import commandLogsRouter from "./command-logs.js";
import adminSessionRouter from "./admin-session.js";
import { adminRateLimit, requireAdmin } from "../middlewares/admin-auth.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(whatsappRouter);
router.use("/admin/session", adminSessionRouter);
router.use("/admin", adminRateLimit, requireAdmin);
router.use("/admin", adminRouter);
router.use("/admin", commandsRouter);
router.use("/admin", groupsRouter);
router.use("/admin", commandLogsRouter);

export default router;
