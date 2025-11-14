import { io } from "socket.io-client";


const URL = "https://market-panic-server.onrender.com";

export const socket = io(URL);

