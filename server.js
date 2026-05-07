const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
app.use(cors());
app.use(express.json());

// Kết nối MySQL 8.0
const pool = mysql.createPool({
    host: 'b8klhhzasfnjq01islfr-mysql.services.clever-cloud.com',
    user: 'uowvngssv2uvho1e',
    password: 'XiRTl6AgynY5bDkyCf8o',
    database: 'b8klhhzasfnjq01islfr',
    port: 3306,
    waitForConnections: true,
    connectionLimit: 3,
    queueLimit: 0
});

// Tự động tạo bảng lưu trạng thái Acknowledge
pool.query(`
    CREATE TABLE IF NOT EXISTS alert_acks (
        room_number VARCHAR(10) NOT NULL,
        alert_type VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (room_number, alert_type)
    )
`).then(() => console.log("✅ Bảng alert_acks đã sẵn sàng!"))
  .catch(err => console.error("Lỗi tạo bảng alert_acks:", err));

let roomSensorCache = {};

// ==========================================
// --- API QUẢN LÝ PHÒNG (ROOMS) ---
// ==========================================
app.route('/api/rooms')
    .get(async (req, res) => {
        try {
            const sql = `
                SELECT 
                    r.room_id as id, 
                    r.room_number, 
                    r.status, 
                    f.floor_number as floor, 
                    rt.type_name as type, 
                    rt.base_price as price, 
                    rt.max_occupancy as occupancy, 
                    rt.description as \`desc\`
                FROM room r
                JOIN floor f ON r.floor_id = f.floor_id
                JOIN room_type rt ON r.type_id = rt.type_id
                ORDER BY r.room_number ASC
            `;
            const [rooms] = await pool.query(sql);
            
            const formattedRooms = rooms.map(room => ({
                ...room,
                price: Number(room.price).toLocaleString('vi-VN')
            }));

            res.json(formattedRooms);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

// API 1: Cập nhật trạng thái phòng (Status)
app.route('/api/rooms/:room_number/status')
    .put(async (req, res) => {
        try {
            const sql = `UPDATE room SET status = ? WHERE room_number = ?`;
            await pool.query(sql, [req.body.status.toLowerCase(), req.params.room_number]);
            res.json({ message: `Cập nhật trạng thái phòng ${req.params.room_number} thành công!` });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

// API 2: Cập nhật loại phòng (Type)
app.route('/api/rooms/:room_number/type')
    .put(async (req, res) => {
        const { type_name } = req.body; 
        const { room_number } = req.params;
        try {
            const [types] = await pool.query('SELECT type_id FROM room_type WHERE type_name = ?', [type_name]);
            if (types.length === 0) {
                return res.status(404).json({ error: "Loại phòng không tồn tại trong database!" });
            }
            const sql = `UPDATE room SET type_id = ? WHERE room_number = ?`;
            await pool.query(sql, [types[0].type_id, room_number]);
            res.json({ message: `Cập nhật loại phòng thành công!` });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

// ==========================================
// --- API QUẢN LÝ KHÁCH HÀNG (GUESTS) ---
// ==========================================
app.route('/api/guests')
    .get(async (req, res) => {
        try {
            const sql = `SELECT * FROM guest ORDER BY guest_id DESC`;
            const [guests] = await pool.query(sql);
            res.json(guests);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    })
    .post(async (req, res) => {
        const data = req.body;
        const nameParts = (data.full_name || '').trim().split(' ');
        const first_name = nameParts[0] || 'Unknown';
        const last_name = nameParts.slice(1).join(' ') || ' ';
        const email = data.email || `guest_${Date.now()}@hotel.com`;
        const dob = data.date_of_birth || '1990-01-01';

        try {
            const sql = `INSERT INTO guest (first_name, last_name, email, phone, nationality, passport_no, gender, date_of_birth, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`;
            await pool.query(sql, [first_name, last_name, email, data.phone, data.nationality, data.passport_no, data.gender, dob]);
            res.status(201).json({ message: "Thêm thành công!" });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

app.route('/api/guests/:id')
    .put(async (req, res) => {
        const data = req.body;
        const nameParts = (data.full_name || '').trim().split(' ');
        const first_name = nameParts[0];
        const last_name = nameParts.slice(1).join(' ') || ' ';
        const dob = data.date_of_birth || '1990-01-01';

        try {
            const sql = `UPDATE guest SET first_name=?, last_name=?, phone=?, nationality=?, passport_no=?, gender=?, date_of_birth=? WHERE guest_id=?`;
            await pool.query(sql, [first_name, last_name, data.phone, data.nationality, data.passport_no, data.gender, dob, req.params.id]);
            res.json({ message: "Cập nhật thành công!" });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    })
    .delete(async (req, res) => {
        try {
            await pool.query("DELETE FROM guest WHERE guest_id = ?", [req.params.id]);
            res.json({ message: "Xóa thành công!" });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

// ==========================================
// --- API QUẢN LÝ ĐẶT PHÒNG (RESERVATIONS/BOOKINGS) ---
// ==========================================
app.route('/api/bookings')
    .get(async (req, res) => {
        try {
            const sql = `
                SELECT b.*, 
                       g.first_name, g.last_name, g.passport_no, g.phone, g.email, g.nationality, g.gender, g.date_of_birth, 
                       r.room_number, rt.type_name as room_type, rt.base_price
                FROM booking b
                JOIN guest g ON b.guest_id = g.guest_id
                JOIN room r ON b.room_id = r.room_id
                JOIN room_type rt ON r.type_id = rt.type_id
                ORDER BY b.booking_id DESC
            `;
            const [bookings] = await pool.query(sql);
            res.json(bookings);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    })
    .post(async (req, res) => {
        const { guest_id, room_id, payment_status, total_price } = req.body;
        const connection = await pool.getConnection(); 
        try {
            await connection.beginTransaction(); 
            const sqlInsert = `
                INSERT INTO booking (guest_id, room_id, check_in_date, check_out_date, status, payment_status, total_price) 
                VALUES (?, ?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 DAY), 'checked_in', ?, ?)
            `;
            await connection.query(sqlInsert, [guest_id, room_id, payment_status, total_price || 0]);
            const sqlUpdate = `UPDATE room SET status = 'occupied' WHERE room_id = ?`;
            await connection.query(sqlUpdate, [room_id]);
            await connection.commit(); 
            res.status(201).json({ message: "Đặt phòng thành công!" });
        } catch (error) {
            await connection.rollback(); 
            res.status(400).json({ error: error.message });
        } finally {
            connection.release(); 
        }
    });

app.route('/api/bookings/:id')
    .put(async (req, res) => {
        const { payment_status, status, check_in_date, check_out_date } = req.body;
        try {
            const sql = `UPDATE booking SET payment_status = ?, status = ?, check_in_date = ?, check_out_date = ? WHERE booking_id = ?`;
            await pool.query(sql, [payment_status, status, check_in_date, check_out_date, req.params.id]);
            res.json({ message: "Cập nhật thành công!" });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    })
    .delete(async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [booking] = await connection.query("SELECT room_id FROM booking WHERE booking_id = ?", [req.params.id]);
            if (booking.length > 0) {
                await connection.query("UPDATE room SET status = 'available' WHERE room_id = ?", [booking[0].room_id]);
            }
            await connection.query("DELETE FROM booking WHERE booking_id = ?", [req.params.id]);
            await connection.commit();
            res.json({ message: "Đã hủy booking và giải phóng phòng!" });
        } catch (error) {
            await connection.rollback();
            res.status(500).json({ error: error.message });
        } finally {
            connection.release();
        }
    });

// ==========================================
// --- API QUẢN LÝ NHÂN VIÊN VÀ GIAO VIỆC ---
// ==========================================
app.get('/api/staff', async (req, res) => {
    try {
        const sql = `
            SELECT s.staff_id, s.first_name, s.last_name, s.phone, s.email, r.role_name,
                   t.task_id, t.task_type, rm.room_number,
                   IF(t.task_id IS NOT NULL, 'Busy', 'Available') as status
            FROM staff s
            JOIN role r ON s.role_id = r.role_id
            LEFT JOIN staff_task t ON s.staff_id = t.staff_id AND t.status = 'In Progress'
            LEFT JOIN room rm ON t.room_id = rm.room_id
            WHERE s.is_active = 1
            ORDER BY s.staff_id ASC
        `;
        const [staffList] = await pool.query(sql);
        const formattedStaff = staffList.map(st => ({
            ...st,
            full_name: `${st.first_name} ${st.last_name}`,
            role: st.role_name
        }));
        res.json(formattedStaff);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tasks', async (req, res) => {
    const { staff_id, room_id, task_type } = req.body;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [checkStaff] = await connection.query("SELECT * FROM staff_task WHERE staff_id = ? AND status = 'In Progress'", [staff_id]);
        if (checkStaff.length > 0) throw new Error("Nhân viên này đang thực hiện một công việc khác!");

        const [checkRoom] = await connection.query("SELECT * FROM staff_task WHERE room_id = ? AND status = 'In Progress'", [room_id]);
        if (checkRoom.length > 0) throw new Error("Phòng này đang được nhân viên khác xử lý!");
        
        await connection.query("INSERT INTO staff_task (staff_id, room_id, task_type) VALUES (?, ?, ?)", [staff_id, room_id, task_type]);
        await connection.query("UPDATE room SET status = ? WHERE room_id = ?", [task_type.toLowerCase(), room_id]);
        
        await connection.commit();
        res.status(201).json({ message: "Giao việc thành công!" });
    } catch (error) {
        await connection.rollback();
        res.status(400).json({ error: error.message });
    } finally {
        connection.release();
    }
});

app.put('/api/tasks/:task_id/complete', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [tasks] = await connection.query("SELECT room_id FROM staff_task WHERE task_id = ?", [req.params.task_id]);
        if (tasks.length > 0) {
            await connection.query("UPDATE room SET status = 'available' WHERE room_id = ?", [tasks[0].room_id]);
        }
        await connection.query("UPDATE staff_task SET status = 'Completed' WHERE task_id = ?", [req.params.task_id]);
        await connection.commit();
        res.json({ message: "Công việc đã hoàn thành, phòng đã sẵn sàng!" });
    } catch (error) {
        await connection.rollback();
        res.status(400).json({ error: error.message });
    } finally {
        connection.release();
    }
});

app.post('/api/staff', async (req, res) => {
    const { first_name, last_name, email, phone, role } = req.body;
    try {
        const role_id = role === 'Housekeeping' ? 1 : 2; 
        await pool.query("INSERT INTO staff (first_name, last_name, email, phone, role_id, password_hash, hire_date) VALUES (?, ?, ?, ?, ?, 'dummy_hash', CURDATE())", 
        [first_name, last_name, email, phone, role_id]);
        res.status(201).json({ message: "Thêm thành công!" });
    } catch (error) { 
        res.status(400).json({ error: error.message }); 
    }
});

app.put('/api/staff/:id', async (req, res) => {
    const { first_name, last_name, phone, role } = req.body;
    try {
        const role_id = role === 'Housekeeping' ? 1 : 2;
        await pool.query("UPDATE staff SET first_name=?, last_name=?, phone=?, role_id=? WHERE staff_id=?", 
        [first_name, last_name, phone, role_id, req.params.id]);
        res.json({ message: "Sửa thành công!" });
    } catch (error) { 
        res.status(400).json({ error: error.message }); 
    }
});

app.delete('/api/staff/:id', async (req, res) => {
    try {
        await pool.query("UPDATE staff SET is_active = 0 WHERE staff_id = ?", [req.params.id]);
        res.json({ message: "Xóa thành công!" });
    } catch (error) { 
        res.status(400).json({ error: error.message }); 
    }
});

// ==========================================
// --- API HỆ THỐNG CẢNH BÁO (ALERTS SYSTEM) ---
// ==========================================
app.post('/api/alerts/acknowledge', async (req, res) => {
    const { alertsToAck } = req.body; 
    if (!alertsToAck || alertsToAck.length === 0) return res.json({ message: "Không có alert nào" });

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        for (let alert of alertsToAck) {
            const sql = `INSERT IGNORE INTO alert_acks (room_number, alert_type) VALUES (?, ?)`;
            await connection.query(sql, [alert.room_number, alert.type]);
        }
        await connection.commit();
        res.json({ message: "Đã lưu trạng thái Acknowledge!" });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
    }
});

app.get('/api/alerts', async (req, res) => {
    try {
        const sql = `
            SELECT r.room_number, f.floor_number, i.* 
            FROM room_iot_state i 
            JOIN room r ON i.room_id = r.room_id 
            JOIN floor f ON r.floor_id = f.floor_id
        `;
        const [rooms] = await pool.query(sql);

        const [acks] = await pool.query("SELECT * FROM alert_acks");
        const ackSet = new Set(acks.map(a => `${a.room_number}-${a.alert_type}`));

        let alerts = [];
        let idCounter = 1;

        const addAlert = (room, type, message, severity, value, sensor) => {
            alerts.push({ 
                id: idCounter++, room_id: room.room_id, room_number: room.room_number, 
                floor: room.floor_number, type, message, severity, status: 'Active', 
                value, sensor, time: 'Just now', 
                is_acknowledged: ackSet.has(`${room.room_number}-${type}`)
            });
        };

        rooms.forEach(room => {
            if (room.humidity > 98 || room.leak_detected) addAlert(room, 'Water Leak', `High humidity (${room.humidity}%) or leak detected. System at risk.`, 'critical', room.humidity, 'Humidity Sensor');
            if (room.noise > 90 || room.siren) addAlert(room, 'Alarm Active', `Siren is active or noise level is critical (${room.noise}dB).`, 'critical', room.noise, 'Sound Sensor');
            if (room.smoke > 40) addAlert(room, 'Smoke Detected', `Smoke level ${room.smoke} ppm detected in room.`, 'critical', room.smoke, 'Smoke Sensor');
            if (room.temp > 36) addAlert(room, 'High Temperature', `Temperature ${room.temp}°C above safe threshold.`, 'warning', room.temp, 'Temperature Sensor');
        });
        res.json(alerts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/alerts/resolve/:room_number/:alert_type', async (req, res) => {
    const { room_number, alert_type } = req.params;
    try {
        const [rooms] = await pool.query("SELECT room_id FROM room WHERE room_number = ?", [room_number]);
        if (rooms.length === 0) return res.status(404).json({ error: "Room not found" });
        const roomId = rooms[0].room_id;

        let sql = "";
        if (alert_type === 'Water Leak') sql = `UPDATE room_iot_state SET sprinkler = 0 WHERE room_id = ?`; 
        else if (alert_type === 'Alarm Active') sql = `UPDATE room_iot_state SET siren = 0, tv = 0 WHERE room_id = ?`; 
        else if (alert_type === 'Smoke Detected' || alert_type === 'High Temperature') sql = `UPDATE room_iot_state SET siren = 0, fan = 1, curtain = 1, door_lock = 0, door_open = 1 WHERE room_id = ?`;

        if (sql) await pool.query(sql, [roomId]);
        await pool.query("DELETE FROM alert_acks WHERE room_number = ? AND alert_type = ?", [room_number, alert_type]);
        res.json({ message: "Action taken! Actuators resetting." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// --- API THIẾT BỊ VÀ ĐIỀU KHIỂN IOT ---
// ==========================================
app.get('/api/iot', async (req, res) => {
    try {
        const sql = `
            SELECT r.room_number, i.* FROM room_iot_state i
            JOIN room r ON i.room_id = r.room_id
        `;
        const [data] = await pool.query(sql);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/iot/:room_number', async (req, res) => {
    try {
        const sql = `
            SELECT i.* 
            FROM room_iot_state i
            JOIN room r ON i.room_id = r.room_id
            WHERE r.room_number = ?
        `;
        const [data] = await pool.query(sql, [req.params.room_number]);
        if (data.length > 0) res.json(data[0]);
        else res.status(404).json({ error: "Không tìm thấy dữ liệu IoT cho phòng này" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/iot/:room_number/control', async (req, res) => {
    const { deviceKey, value } = req.body; 
    try {
        const [rooms] = await pool.query("SELECT room_id FROM room WHERE room_number = ?", [req.params.room_number]);
        if (rooms.length === 0) return res.status(404).json({ error: "Không tìm thấy phòng" });
        
        const roomId = rooms[0].room_id;
        
        if (deviceKey === 'door_lock') {
            const doorOpenValue = !value;
            const sql = `UPDATE room_iot_state SET door_lock = ?, door_open = ? WHERE room_id = ?`;
            await pool.query(sql, [value, doorOpenValue, roomId]);
        } else {
            const sql = `UPDATE room_iot_state SET ${deviceKey} = ? WHERE room_id = ?`;
            await pool.query(sql, [value, roomId]);
        }
        res.json({ message: "Đã cập nhật thiết bị" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// --- HỆ THỐNG MÔ PHỎNG VẬT LÝ IOT (ĐÃ FIX CHO VERCEL) ---
// ============================================================
const randomNoise = (min, max) => Math.random() * (max - min) + min;
const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

const runIoTSimulation = async () => {
    try {
        const [rooms] = await pool.query('SELECT * FROM room_iot_state');
        
        for (let room of rooms) {
            let currentEnergy = Number(room.energy) || 0;
            let energyCost = 0; 
            let currentSiren = room.siren;

            let targetTemp = 32.0;       
            let targetHumidity = 65.0;   
            let targetCo2 = 400.0;       
            let targetLight = 5.0;      
            let targetNoise = 30.0;      

            let currentSmoke = Number(room.smoke) || 0;
            if (Math.random() < 0.03) {
                currentSmoke += randomNoise(15, 30); 
            }
            let smokeClearRate = 0.5; 

            if (room.main_power) {
                energyCost += 0.001; 
                if (room.main_light) { targetLight += 300; energyCost += 0.01; }
                if (room.desk_lamp) { targetLight += 100; energyCost += 0.005; }
                if (room.bedside_lamp) { targetLight += 50; energyCost += 0.002; }
                if (room.tv) { targetLight += 30; targetNoise += 35; energyCost += 0.02; }
                
                if (room.ac_power) { 
                    targetTemp = room.ac_temp; 
                    targetHumidity = 45.0; 
                    energyCost += 0.05; 
                }
                if (room.fan) { 
                    targetHumidity -= 10; 
                    targetCo2 = Math.max(400, targetCo2 - 50); 
                    targetNoise += 15; 
                    energyCost += 0.01; 
                    smokeClearRate += 20; 
                }
                if (room.sprinkler) { 
                    targetHumidity = 100; 
                    targetTemp = 25.0; 
                    energyCost += 0.03; 
                    smokeClearRate += 100; 
                }
            }

            if (room.curtain) { targetLight += 400; targetCo2 = 400; smokeClearRate += 15; }
            if (room.door_open) { targetCo2 = 400; smokeClearRate += 15; }
            if (room.motion) { targetCo2 += 150; targetTemp += 0.5; }

            let newSmoke = currentSmoke - smokeClearRate;
            newSmoke = Math.max(0, newSmoke); 
            if (newSmoke > 0) newSmoke += randomNoise(-0.2, 0.2); 

            if (newSmoke > 30 && !currentSiren && room.main_power) {
                currentSiren = true;
            }
            if (currentSiren) { targetNoise = 120; energyCost += 0.01; }

            let newTemp = room.temp + (targetTemp - room.temp) * 0.5 + randomNoise(-0.1, 0.1);
            let newHumidity = room.humidity + (targetHumidity - room.humidity) * 0.6 + randomNoise(-0.5, 0.5);
            let newCo2 = room.co2 + (targetCo2 - room.co2) * 0.7 + randomNoise(-2, 2);
            
            let newLight = targetLight + randomNoise(-2, 2);
            let newNoise = targetNoise + randomNoise(-1, 1);

            newTemp = clamp(newTemp, 16, 45);
            newHumidity = clamp(newHumidity, 20, 100);
            newSmoke = clamp(newSmoke, 0, 1000);
            newCo2 = clamp(newCo2, 300, 2000);
            newLight = clamp(newLight, 0, 1500);
            newNoise = clamp(newNoise, 20, 130);

            let newEnergy = currentEnergy + energyCost;
            let leakDetected = newHumidity > 98;
            let newMotion = Math.random() < 0.05 ? !room.motion : room.motion;

            const sqlUpdate = `
                UPDATE room_iot_state 
                SET temp=?, humidity=?, smoke=?, co2=?, light=?, noise=?, motion=?, energy=?, leak_detected=?, siren=?
                WHERE room_id=?
            `;
            await pool.query(sqlUpdate, [
                newTemp.toFixed(2), newHumidity.toFixed(2), newSmoke.toFixed(2), 
                newCo2.toFixed(2), newLight.toFixed(2), newNoise.toFixed(2), 
                newMotion, newEnergy.toFixed(3), leakDetected, currentSiren, room.room_id
            ]);
        }
    } catch (error) {
        console.error("Lỗi mô phỏng IoT:", error);
    }
};

// ============================================================
// API ĐIỂM CHẠM CHO VERCEL ĐỂ CHẠY MÔ PHỎNG IOT
// ============================================================
app.get('/api/simulate', async (req, res) => {
    try {
        await runIoTSimulation();
        res.json({ message: "IoT Simulation tick updated!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = app;

if (require.main === module) {
    const PORT = 5000;
    app.listen(PORT, () => {
        console.log(`🚀 API Hotel Server chạy tại api-hotel-eight.vercel.app:${PORT}`);
    });
}
