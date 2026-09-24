-- ========================================================
-- BookGuard Real-Time Indian Travel Inventory Dataset
-- Comprehensive multi-modal coverage across 8 major Indian cities:
-- BLR (Bengaluru), GOI (Goa), DEL (New Delhi), BOM (Mumbai),
-- HYD (Hyderabad), JAI (Jaipur), COK (Kochi), MAA (Chennai)
-- ========================================================

-- Clear existing data
TRUNCATE TABLE ops_trace_events CASCADE;
TRUNCATE TABLE ai_decisions CASCADE;
TRUNCATE TABLE booking_events CASCADE;
TRUNCATE TABLE booking_items CASCADE;
TRUNCATE TABLE provider_reservations CASCADE;
TRUNCATE TABLE idempotency_keys CASCADE;
TRUNCATE TABLE holds CASCADE;
TRUNCATE TABLE bookings CASCADE;
TRUNCATE TABLE inventory CASCADE;
TRUNCATE TABLE travellers CASCADE;

-- Insert Seed Travellers
INSERT INTO travellers (id, name, email, phone, language_pref) VALUES
('traveller_priya', 'Priya Sharma', 'priya.sharma@gmail.com', '+91 98765 43210', 'en'),
('traveller_arjun', 'Arjun Verma', 'arjun.verma@outlook.com', '+91 98451 22334', 'hi'),
('traveller_rahul', 'Rahul Nair', 'rahul.nair@yahoo.com', '+91 99001 55667', 'kn'),
('traveller_ananya', 'Ananya Iyer', 'ananya.iyer@gmail.com', '+91 97112 33445', 'en'),
('traveller_vikram', 'Vikram Rathore', 'vikram.rathore@gmail.com', '+91 98223 55667', 'en');

-- ========================================================
-- 1. FLIGHTS (IndiGo, Air India, Vistara, Akasa Air, AIX, SpiceJet)
-- ========================================================
INSERT INTO inventory (
    id, resource_type, code, name, origin, destination, 
    travel_date, departure_time, arrival_time, price, 
    total_quantity, available_quantity, held_quantity, confirmed_quantity
) VALUES
-- Bengaluru (BLR) <-> Goa (GOI)
('flt_blr_goi_ix6534', 'flight', 'IX 6534', 'Air India Express', 'BLR', 'GOI', '2026-09-25', '06:10', '07:25', 4120.00, 4, 4, 0, 0),
('flt_blr_goi_ix6538', 'flight', 'IX 6538', 'Air India Express', 'BLR', 'GOI', '2026-09-25', '09:40', '10:55', 4410.00, 5, 5, 0, 0),
('flt_blr_goi_6e511', 'flight', '6E 511', 'IndiGo Express', 'BLR', 'GOI', '2026-09-25', '13:05', '14:20', 4860.00, 6, 6, 0, 0),
('flt_blr_goi_qp1302', 'flight', 'QP 1302', 'Akasa Air', 'BLR', 'GOI', '2026-09-25', '18:30', '19:45', 3950.00, 8, 8, 0, 0),
('flt_goi_blr_6e512', 'flight', '6E 512', 'IndiGo Express', 'GOI', 'BLR', '2026-09-25', '15:10', '16:25', 4650.00, 6, 6, 0, 0),
('flt_goi_blr_ix6539', 'flight', 'IX 6539', 'Air India Express', 'GOI', 'BLR', '2026-09-25', '20:30', '21:45', 4200.00, 5, 5, 0, 0),

-- Delhi (DEL) <-> Mumbai (BOM)
('flt_del_bom_uk879', 'flight', 'UK 879', 'Vistara Prime', 'DEL', 'BOM', '2026-09-25', '07:00', '09:15', 5620.00, 6, 6, 0, 0),
('flt_del_bom_ai806', 'flight', 'AI 806', 'Air India', 'DEL', 'BOM', '2026-09-25', '11:15', '13:30', 5200.00, 5, 5, 0, 0),
('flt_del_bom_6e2054', 'flight', '6E 2054', 'IndiGo Express', 'DEL', 'BOM', '2026-09-25', '16:45', '19:00', 4950.00, 8, 8, 0, 0),
('flt_bom_del_uk880', 'flight', 'UK 880', 'Vistara Prime', 'BOM', 'DEL', '2026-09-25', '06:30', '08:45', 5700.00, 6, 6, 0, 0),
('flt_bom_del_6e2055', 'flight', '6E 2055', 'IndiGo Express', 'BOM', 'DEL', '2026-09-25', '18:00', '20:15', 5100.00, 7, 7, 0, 0),

-- Mumbai (BOM) <-> Goa (GOI)
('flt_bom_goi_6e6125', 'flight', '6E 6125', 'IndiGo Express', 'BOM', 'GOI', '2026-09-25', '08:20', '09:30', 3800.00, 5, 5, 0, 0),
('flt_bom_goi_ai504', 'flight', 'AI 504', 'Air India Premium', 'BOM', 'GOI', '2026-09-25', '14:10', '15:25', 4350.00, 5, 5, 0, 0),
('flt_goi_bom_6e6126', 'flight', '6E 6126', 'IndiGo Express', 'GOI', 'BOM', '2026-09-25', '16:30', '17:40', 3920.00, 6, 6, 0, 0),

-- Bengaluru (BLR) <-> Delhi (DEL)
('flt_blr_del_uk819', 'flight', 'UK 819', 'Vistara Club', 'BLR', 'DEL', '2026-09-25', '10:30', '13:15', 6450.00, 5, 5, 0, 0),
('flt_blr_del_6e213', 'flight', '6E 213', 'IndiGo Express', 'BLR', 'DEL', '2026-09-25', '19:00', '21:50', 5100.00, 6, 6, 0, 0),
('flt_del_blr_6e214', 'flight', '6E 214', 'IndiGo Express', 'DEL', 'BLR', '2026-09-25', '07:15', '10:05', 5250.00, 6, 6, 0, 0),

-- Bengaluru (BLR) <-> Mumbai (BOM)
('flt_blr_bom_6e421', 'flight', '6E 421', 'IndiGo Express', 'BLR', 'BOM', '2026-09-25', '08:00', '09:40', 4300.00, 7, 7, 0, 0),
('flt_blr_bom_ai630', 'flight', 'AI 630', 'Air India Business', 'BLR', 'BOM', '2026-09-25', '17:15', '19:00', 4750.00, 4, 4, 0, 0),
('flt_bom_blr_6e422', 'flight', '6E 422', 'IndiGo Express', 'BOM', 'BLR', '2026-09-25', '11:00', '12:45', 4400.00, 6, 6, 0, 0),

-- Hyderabad (HYD) <-> Bengaluru (BLR) / Goa (GOI)
('flt_hyd_blr_6e801', 'flight', '6E 801', 'IndiGo Shuttle', 'HYD', 'BLR', '2026-09-25', '07:30', '08:45', 3150.00, 8, 8, 0, 0),
('flt_blr_hyd_6e802', 'flight', '6E 802', 'IndiGo Shuttle', 'BLR', 'HYD', '2026-09-25', '19:30', '20:45', 3200.00, 8, 8, 0, 0),
('flt_hyd_goi_qp144', 'flight', 'QP 144', 'Akasa Air', 'HYD', 'GOI', '2026-09-25', '10:00', '11:20', 3850.00, 5, 5, 0, 0),
('flt_goi_hyd_qp145', 'flight', 'QP 145', 'Akasa Air', 'GOI', 'HYD', '2026-09-25', '12:00', '13:20', 3900.00, 5, 5, 0, 0),

-- Delhi (DEL) <-> Jaipur (JAI) / Goa (GOI)
('flt_del_jai_ai491', 'flight', 'AI 491', 'Air India Express', 'DEL', 'JAI', '2026-09-25', '09:00', '09:55', 2850.00, 6, 6, 0, 0),
('flt_jai_del_ai492', 'flight', 'AI 492', 'Air India Express', 'JAI', 'DEL', '2026-09-25', '18:15', '19:10', 2900.00, 6, 6, 0, 0),
('flt_del_goi_6e5223', 'flight', '6E 5223', 'IndiGo Express', 'DEL', 'GOI', '2026-09-25', '10:30', '13:10', 6200.00, 5, 5, 0, 0),
('flt_goi_del_6e5224', 'flight', '6E 5224', 'IndiGo Express', 'GOI', 'DEL', '2026-09-25', '14:00', '16:40', 6350.00, 5, 5, 0, 0),

-- Chennai (MAA) <-> Bengaluru (BLR) / Mumbai (BOM) / Goa (GOI)
('flt_maa_blr_6e301', 'flight', '6E 301', 'IndiGo Shuttle', 'MAA', 'BLR', '2026-09-25', '06:45', '07:40', 2750.00, 8, 8, 0, 0),
('flt_blr_maa_6e302', 'flight', '6E 302', 'IndiGo Shuttle', 'BLR', 'MAA', '2026-09-25', '21:15', '22:10', 2800.00, 7, 7, 0, 0),
('flt_maa_bom_ai571', 'flight', 'AI 571', 'Air India', 'MAA', 'BOM', '2026-09-25', '09:15', '11:15', 4200.00, 6, 6, 0, 0),
('flt_maa_goi_6e448', 'flight', '6E 448', 'IndiGo Coastal', 'MAA', 'GOI', '2026-09-25', '12:00', '13:45', 4600.00, 4, 4, 0, 0),

-- Kochi (COK) <-> Bengaluru (BLR) / Mumbai (BOM) / Delhi (DEL)
('flt_blr_cok_ai510', 'flight', 'AI 510', 'Air India Express', 'BLR', 'COK', '2026-09-25', '08:20', '09:30', 3100.00, 6, 6, 0, 0),
('flt_cok_blr_ai511', 'flight', 'AI 511', 'Air India Express', 'COK', 'BLR', '2026-09-25', '19:40', '20:50', 3200.00, 6, 6, 0, 0),
('flt_bom_cok_6e191', 'flight', '6E 191', 'IndiGo Express', 'BOM', 'COK', '2026-09-25', '13:00', '15:00', 4500.00, 5, 5, 0, 0),
('flt_del_cok_uk883', 'flight', 'UK 883', 'Vistara Club', 'DEL', 'COK', '2026-09-25', '06:00', '09:15', 7400.00, 4, 4, 0, 0);

-- ========================================================
-- 2. IRCTC TRAINS (Vande Bharat, Rajdhani, Shatabdi, Duronto, Express)
-- Note: Train routes use standard city codes (BLR, GOI, DEL, BOM, HYD, JAI, COK, MAA)
-- for flawless multi-modal unified search matching!
-- ========================================================
INSERT INTO inventory (
    id, resource_type, code, name, origin, destination, 
    travel_date, departure_time, arrival_time, price, 
    total_quantity, available_quantity, held_quantity, confirmed_quantity
) VALUES
-- Bengaluru (BLR) <-> Goa (GOI)
('trn_vande_bharat_20641', 'train', 'VB 20641', 'IRCTC Vande Bharat Express (Executive Chair)', 'BLR', 'GOI', '2026-09-25', '05:45', '13:20', 1870.00, 4, 4, 0, 0),
('trn_goa_express_12779', 'train', 'EXP 12779', 'IRCTC Goa Express (2-Tier AC Sleeper)', 'BLR', 'GOI', '2026-09-25', '15:10', '04:30', 1120.00, 6, 6, 0, 0),
('trn_vande_bharat_20642', 'train', 'VB 20642', 'IRCTC Vande Bharat Express (Executive Chair)', 'GOI', 'BLR', '2026-09-25', '14:30', '22:05', 1870.00, 4, 4, 0, 0),

-- Delhi (DEL) <-> Mumbai (BOM)
('trn_rajdhani_12951', 'train', 'RAJ 12951', 'IRCTC Mumbai Tejas Rajdhani (1st AC)', 'DEL', 'BOM', '2026-09-25', '16:55', '08:35', 3450.00, 3, 3, 0, 0),
('trn_rajdhani_12952', 'train', 'RAJ 12952', 'IRCTC Mumbai Rajdhani (2-Tier AC)', 'DEL', 'BOM', '2026-09-25', '16:55', '08:35', 2420.00, 6, 6, 0, 0),
('trn_rajdhani_12953', 'train', 'RAJ 12953', 'IRCTC August Kranti Rajdhani (2-Tier AC)', 'BOM', 'DEL', '2026-09-25', '17:10', '09:45', 2450.00, 5, 5, 0, 0),

-- Mumbai (BOM) <-> Goa (GOI)
('trn_shatabdi_12009', 'train', 'SHAT 12009', 'IRCTC Shatabdi Express (AC Chair Car)', 'BOM', 'GOI', '2026-09-25', '06:20', '13:00', 1480.00, 6, 6, 0, 0),
('trn_tejas_22119', 'train', 'TEJAS 22119', 'IRCTC Tejas Express (Smart AC Chair)', 'BOM', 'GOI', '2026-09-25', '05:50', '14:00', 1650.00, 5, 5, 0, 0),
('trn_tejas_22120', 'train', 'TEJAS 22120', 'IRCTC Tejas Express (Smart AC Chair)', 'GOI', 'BOM', '2026-09-25', '15:15', '23:30', 1650.00, 5, 5, 0, 0),

-- Delhi (DEL) <-> Bengaluru (BLR)
('trn_duronto_12213', 'train', 'DUR 12213', 'IRCTC Duronto Superfast Express (3-Tier AC)', 'DEL', 'BLR', '2026-09-25', '23:00', '06:40', 2150.00, 8, 8, 0, 0),
('trn_karnataka_exp_12627', 'train', 'EXP 12627', 'IRCTC Karnataka Express (2-Tier AC)', 'BLR', 'DEL', '2026-09-25', '19:20', '09:00', 2600.00, 6, 6, 0, 0),

-- Delhi (DEL) <-> Jaipur (JAI)
('trn_shatabdi_12015', 'train', 'SHAT 12015', 'IRCTC Ajmer Shatabdi (Executive AC)', 'DEL', 'JAI', '2026-09-25', '06:10', '10:40', 980.00, 8, 8, 0, 0),
('trn_vande_bharat_20977', 'train', 'VB 20977', 'IRCTC Vande Bharat Express (AC Chair Car)', 'DEL', 'JAI', '2026-09-25', '15:00', '18:50', 1150.00, 6, 6, 0, 0),
('trn_vande_bharat_20978', 'train', 'VB 20978', 'IRCTC Vande Bharat Express (AC Chair Car)', 'JAI', 'DEL', '2026-09-25', '07:50', '11:40', 1150.00, 6, 6, 0, 0),

-- Bengaluru (BLR) <-> Chennai (MAA)
('trn_vande_bharat_20607', 'train', 'VB 20607', 'IRCTC Vande Bharat Express (Executive Chair)', 'MAA', 'BLR', '2026-09-25', '05:50', '10:20', 1080.00, 7, 7, 0, 0),
('trn_vande_bharat_20608', 'train', 'VB 20608', 'IRCTC Vande Bharat Express (Executive Chair)', 'BLR', 'MAA', '2026-09-25', '14:50', '19:20', 1080.00, 7, 7, 0, 0),
('trn_shatabdi_12028', 'train', 'SHAT 12028', 'IRCTC Shatabdi Express (AC Chair Car)', 'BLR', 'MAA', '2026-09-25', '06:00', '11:00', 890.00, 8, 8, 0, 0),

-- Hyderabad (HYD) <-> Bengaluru (BLR)
('trn_vande_bharat_20703', 'train', 'VB 20703', 'IRCTC Vande Bharat Kacheguda (AC Chair)', 'HYD', 'BLR', '2026-09-25', '06:15', '14:00', 1540.00, 5, 5, 0, 0),
('trn_vande_bharat_20704', 'train', 'VB 20704', 'IRCTC Vande Bharat Express (AC Chair)', 'BLR', 'HYD', '2026-09-25', '14:45', '22:30', 1540.00, 5, 5, 0, 0),

-- Bengaluru (BLR) <-> Kochi (COK)
('trn_vande_bharat_20645', 'train', 'VB 20645', 'IRCTC Vande Bharat Express (AC Chair Car)', 'BLR', 'COK', '2026-09-25', '05:30', '14:20', 1690.00, 5, 5, 0, 0),
('trn_island_exp_16526', 'train', 'EXP 16526', 'IRCTC Island Express (2-Tier AC Sleeper)', 'BLR', 'COK', '2026-09-25', '20:10', '07:20', 1240.00, 6, 6, 0, 0);

-- ========================================================
-- 3. REDBUS SLEEPER BUSES (SRS, VRL, IntrCity, Zingbus, Orange Tours, KSRTC)
-- ========================================================
INSERT INTO inventory (
    id, resource_type, code, name, origin, destination, 
    travel_date, departure_time, arrival_time, price, 
    total_quantity, available_quantity, held_quantity, confirmed_quantity
) VALUES
-- Bengaluru (BLR) <-> Goa (GOI)
('bus_srs_volvo_991', 'bus', 'SRS-991', 'RedBus SRS Multi-Axle Volvo AC Sleeper (2+1)', 'BLR', 'GOI', '2026-09-25', '21:00', '07:30', 1450.00, 3, 3, 0, 0),
('bus_vrl_electric_404', 'bus', 'VRL-404', 'RedBus VRL I-Shift Electric Sleeper', 'BLR', 'GOI', '2026-09-25', '22:30', '08:45', 1620.00, 7, 7, 0, 0),
('bus_srs_volvo_992', 'bus', 'SRS-992', 'RedBus SRS Multi-Axle Volvo AC Sleeper (2+1)', 'GOI', 'BLR', '2026-09-25', '20:30', '07:00', 1450.00, 4, 4, 0, 0),

-- Delhi (DEL) <-> Jaipur (JAI)
('bus_intrcity_smart_102', 'bus', 'INTR-102', 'IntrCity SmartBus Luxury Club AC', 'DEL', 'JAI', '2026-09-25', '06:00', '11:15', 780.00, 8, 8, 0, 0),
('bus_zingbus_lounge_505', 'bus', 'ZING-505', 'Zingbus Electric Lounge Sleeper', 'DEL', 'JAI', '2026-09-25', '17:30', '22:45', 890.00, 6, 6, 0, 0),
('bus_intrcity_smart_103', 'bus', 'INTR-103', 'IntrCity SmartBus Luxury Club AC', 'JAI', 'DEL', '2026-09-25', '16:00', '21:15', 780.00, 7, 7, 0, 0),

-- Hyderabad (HYD) <-> Bengaluru (BLR)
('bus_orange_tours_77', 'bus', 'ORG-77', 'Orange Tours Scania Multi-Axle AC Sleeper', 'HYD', 'BLR', '2026-09-25', '22:00', '06:30', 1350.00, 5, 5, 0, 0),
('bus_orange_tours_78', 'bus', 'ORG-78', 'Orange Tours Scania Multi-Axle AC Sleeper', 'BLR', 'HYD', '2026-09-25', '22:30', '07:00', 1350.00, 6, 6, 0, 0),

-- Bengaluru (BLR) <-> Chennai (MAA)
('bus_ksrtc_airavat_412', 'bus', 'KSRTC-412', 'KSRTC Airavat Club Class Multi-Axle AC', 'BLR', 'MAA', '2026-09-25', '06:30', '12:00', 820.00, 8, 8, 0, 0),
('bus_ksrtc_airavat_413', 'bus', 'KSRTC-413', 'KSRTC Airavat Club Class Multi-Axle AC', 'BLR', 'MAA', '2026-09-25', '15:00', '20:30', 820.00, 8, 8, 0, 0),
('bus_ksrtc_airavat_414', 'bus', 'KSRTC-414', 'KSRTC Airavat Club Class Multi-Axle AC', 'MAA', 'BLR', '2026-09-25', '14:00', '19:30', 820.00, 8, 8, 0, 0),

-- Mumbai (BOM) <-> Goa (GOI)
('bus_vrl_bom_goi_510', 'bus', 'VRL-510', 'RedBus VRL Multi-Axle Volvo AC Sleeper', 'BOM', 'GOI', '2026-09-25', '20:00', '08:00', 1550.00, 5, 5, 0, 0),
('bus_vrl_goi_bom_511', 'bus', 'VRL-511', 'RedBus VRL Multi-Axle Volvo AC Sleeper', 'GOI', 'BOM', '2026-09-25', '19:30', '07:30', 1550.00, 5, 5, 0, 0),

-- Bengaluru (BLR) <-> Kochi (COK)
('bus_kallada_g4_702', 'bus', 'KALLADA-702', 'Kallada G4 Scania Multi-Axle AC Sleeper', 'BLR', 'COK', '2026-09-25', '21:30', '07:15', 1400.00, 6, 6, 0, 0),
('bus_kallada_g4_703', 'bus', 'KALLADA-703', 'Kallada G4 Scania Multi-Axle AC Sleeper', 'COK', 'BLR', '2026-09-25', '21:00', '06:45', 1400.00, 6, 6, 0, 0);

-- ========================================================
-- 4. HOTELS & LUXURY RESORTS (Every City in India Covered)
-- ========================================================
INSERT INTO inventory (
    id, resource_type, code, name, origin, destination, 
    travel_date, departure_time, arrival_time, price, 
    total_quantity, available_quantity, held_quantity, confirmed_quantity
) VALUES
-- Goa (GOI)
('htl_last_room_suite', 'hotel', 'HTL-ROYAL-01', 'Royal Heritage Ocean Suite (Last 1 Room!)', 'GOI', 'GOI', '2026-09-25', '14:00', '11:00', 4500.00, 1, 1, 0, 0),
('htl_goa_grand_resort', 'hotel', 'HTL-GOA-01', 'Grand Goa Beachfront Resort & Spa (5★)', 'GOI', 'GOI', '2026-09-25', '14:00', '11:00', 6500.00, 5, 5, 0, 0),
('htl_taj_aguada', 'hotel', 'HTL-TAJ-02', 'Taj Fort Aguada Heritage Resort & Private Beach', 'GOI', 'GOI', '2026-09-25', '14:00', '12:00', 8200.00, 4, 4, 0, 0),
('htl_w_goa', 'hotel', 'HTL-W-GOA', 'W Goa Vagator Cliffside Luxury Villa', 'GOI', 'GOI', '2026-09-25', '15:00', '12:00', 12500.00, 3, 3, 0, 0),

-- Mumbai (BOM)
('htl_taj_mahal_palace', 'hotel', 'HTL-TAJ-MUM', 'The Taj Mahal Palace Luxury Sea-Facing Suite', 'BOM', 'BOM', '2026-09-25', '14:00', '12:00', 11500.00, 3, 3, 0, 0),
('htl_trident_nariman', 'hotel', 'HTL-TRIDENT-01', 'Trident Nariman Point Marine Drive View', 'BOM', 'BOM', '2026-09-25', '14:00', '12:00', 8900.00, 4, 4, 0, 0),

-- Delhi (DEL)
('htl_leela_palace_del', 'hotel', 'HTL-LEELA-DEL', 'The Leela Palace New Delhi Diplomatic Enclave (5★)', 'DEL', 'DEL', '2026-09-25', '14:00', '12:00', 10800.00, 4, 4, 0, 0),
('htl_taj_mahal_delhi', 'hotel', 'HTL-TAJ-DEL', 'Taj Mahal Hotel Mansingh Road Premier Suite', 'DEL', 'DEL', '2026-09-25', '14:00', '12:00', 9200.00, 3, 3, 0, 0),

-- Bengaluru (BLR)
('htl_itc_gardenia', 'hotel', 'HTL-ITC-BLR', 'ITC Gardenia Luxury Collection Hotel', 'BLR', 'BLR', '2026-09-25', '14:00', '12:00', 7400.00, 4, 4, 0, 0),
('htl_leela_blr', 'hotel', 'HTL-LEELA-BLR', 'The Leela Palace Bengaluru Royal Club Room', 'BLR', 'BLR', '2026-09-25', '14:00', '12:00', 8500.00, 4, 4, 0, 0),

-- Jaipur (JAI)
('htl_oberoi_amarvilas', 'hotel', 'HTL-OBEROI-03', 'The Oberoi Rajvilas Luxury Heritage Palace', 'JAI', 'JAI', '2026-09-25', '14:00', '12:00', 9800.00, 3, 3, 0, 0),
('htl_rambagh_palace', 'hotel', 'HTL-RAMBAGH', 'Taj Rambagh Palace Royal Suite', 'JAI', 'JAI', '2026-09-25', '14:00', '12:00', 14500.00, 2, 2, 0, 0),

-- Kochi / Kerala (COK)
('htl_kumarakom_lake', 'hotel', 'HTL-KERALA-01', 'Kumarakom Lake Resort & Heritage Villa', 'COK', 'COK', '2026-09-25', '14:00', '11:00', 8900.00, 4, 4, 0, 0),
('htl_taj_malabar', 'hotel', 'HTL-TAJ-COK', 'Taj Malabar Resort & Spa Cochin Harbour View', 'COK', 'COK', '2026-09-25', '14:00', '12:00', 7800.00, 4, 4, 0, 0),

-- Hyderabad (HYD)
('htl_falaknuma_palace', 'hotel', 'HTL-FALAKNUMA', 'Taj Falaknuma Palace Royal Nizam Suite', 'HYD', 'HYD', '2026-09-25', '14:00', '12:00', 16500.00, 2, 2, 0, 0),
('htl_park_hyatt_hyd', 'hotel', 'HTL-HYATT-HYD', 'Park Hyatt Banjara Hills Executive Suite', 'HYD', 'HYD', '2026-09-25', '14:00', '12:00', 6800.00, 5, 5, 0, 0),

-- Chennai (MAA)
('htl_leela_palace_maa', 'hotel', 'HTL-LEELA-MAA', 'The Leela Palace Chennai Marina Sea-Facing Room', 'MAA', 'MAA', '2026-09-25', '14:00', '12:00', 7900.00, 4, 4, 0, 0),
('htl_itc_grand_chola', 'hotel', 'HTL-CHOLA-MAA', 'ITC Grand Chola Luxury Collection Palace Hotel', 'MAA', 'MAA', '2026-09-25', '14:00', '12:00', 8200.00, 5, 5, 0, 0),

-- Dedicated Concurrency Demo Fixture (Goa) — used by `npm run demo:hotel-concurrency`
('htl_concurrency_demo', 'hotel', 'HTL-DEMO-05', 'BookGuard Concurrency Demo Suites (5 Rooms)', 'GOI', 'GOI', '2026-09-25', '14:00', '11:00', 5000.00, 5, 5, 0, 0);

-- ========================================================
-- 5. ALL-IN-ONE HOLIDAY PACKAGES & BUNDLES (Multi-Leg Itineraries)
-- ========================================================
INSERT INTO inventory (
    id, resource_type, code, name, origin, destination, 
    travel_date, departure_time, arrival_time, price, 
    total_quantity, available_quantity, held_quantity, confirmed_quantity
) VALUES
('pkg_goa_deluxe_3d', 'package', 'PKG-GOA-3D', 'Goa 3-Day Beach Vacation (Flight + 5★ Resort + Transfer)', 'BLR', 'GOI', '2026-09-25', '06:10', '14:00', 11200.00, 2, 2, 0, 0),
('pkg_goa_deluxe_del', 'package', 'PKG-GOA-DEL', 'Goa 4-Day Coastal Escape (Delhi Flight + Oceanfront Villa)', 'DEL', 'GOI', '2026-09-25', '10:30', '15:00', 16500.00, 3, 3, 0, 0),
('pkg_golden_triangle_4d', 'package', 'PKG-RAJ-4D', 'Golden Triangle Heritage Tour (Delhi + Jaipur Palace + AC Volvo)', 'DEL', 'JAI', '2026-09-25', '06:00', '14:00', 14800.00, 3, 3, 0, 0),
('pkg_kerala_backwaters_3d', 'package', 'PKG-KER-3D', 'Kerala 3-Day Backwaters Cruise & Lake Villa', 'BLR', 'COK', '2026-09-25', '07:30', '13:00', 13900.00, 3, 3, 0, 0),
('pkg_mumbai_goa_tejas', 'package', 'PKG-BOM-GOI', 'Mumbai to Goa Tejas Superfast & Beachfront Heritage Stay', 'BOM', 'GOI', '2026-09-25', '05:50', '14:30', 9800.00, 3, 3, 0, 0);
