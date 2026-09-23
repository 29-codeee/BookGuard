import React, { useState } from 'react';
import { 
  X, 
  ShieldCheck, 
  CreditCard, 
  QrCode, 
  Smartphone, 
  Building, 
  CheckCircle2, 
  Lock, 
  ArrowRight,
  User,
  Mail,
  Phone,
  Calendar,
  AlertTriangle,
  Zap
} from 'lucide-react';

interface PassengerCheckoutModalProps {
  item: any;
  hold: any;
  isOpen: boolean;
  onClose: () => void;
  onConfirmPayment: (passengerDetails: any, paymentDetails: any) => Promise<void>;
  isProcessing: boolean;
}

export const PassengerCheckoutModal: React.FC<PassengerCheckoutModalProps> = ({
  item,
  hold,
  isOpen,
  onClose,
  onConfirmPayment,
  isProcessing
}) => {
  const [step, setStep] = useState<'details' | 'payment'>('details');

  // Passenger Form State
  const [fullName, setFullName] = useState('Priya Sharma');
  const [email, setEmail] = useState('priya.sharma@gmail.com');
  const [phone, setPhone] = useState('+91 98765 43210');
  const [age, setAge] = useState('28');
  const [gender, setGender] = useState('Female');
  const [seatPreference, setSeatPreference] = useState('Window Seat');
  const [idType, setIdType] = useState('Aadhaar Card');
  const [idNumber, setIdNumber] = useState('XXXX-XXXX-4091');

  // Payment Form State
  const [paymentMethod, setPaymentMethod] = useState<'upi_qr' | 'upi_id' | 'card' | 'netbanking'>('upi_qr');
  const [upiId, setUpiId] = useState('priyasharma@okhdfcbank');
  const [cardNumber, setCardNumber] = useState('4532 •••• •••• 8821');
  const [cardExpiry, setCardExpiry] = useState('08/29');
  const [cardCvv, setCardCvv] = useState('•••');
  const [bankName, setBankName] = useState('HDFC Bank');

  if (!isOpen || !item) return null;

  const basePrice = parseFloat(item.price);
  const taxAmount = Math.round(basePrice * 0.05); // 5% GST
  const totalAmount = basePrice + taxAmount;

  const handleProceedToPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName || !email || !phone) {
      alert('Please fill in passenger name, email, and phone number.');
      return;
    }
    setStep('payment');
  };

  const handleFinalPayment = async () => {
    const passengerData = {
      name: fullName,
      email,
      phone,
      age,
      gender,
      seatPreference,
      idType,
      idNumber
    };

    const paymentData = {
      method: paymentMethod === 'upi_qr' ? 'UPI (QR Scan)' : 
              paymentMethod === 'upi_id' ? `UPI (${upiId})` : 
              paymentMethod === 'card' ? 'Visa Credit Card (•••• 8821)' : 
              `NetBanking (${bankName})`,
      amount: totalAmount,
      transactionRef: `TXN_RZP_${Date.now().toString().slice(-8)}`,
      paidAt: new Date().toISOString()
    };

    await onConfirmPayment(passengerData, paymentData);
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(2, 6, 23, 0.85)',
      backdropFilter: 'blur(10px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: 16
    }}>
      <div style={{
        background: '#090d16',
        border: '1px solid rgba(56, 189, 248, 0.3)',
        borderRadius: 20,
        maxWidth: 760,
        width: '100%',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Modal Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(255, 255, 255, 0.02)'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                background: 'rgba(14, 165, 233, 0.2)',
                color: '#38bdf8',
                fontWeight: 800,
                fontSize: '0.72rem',
                padding: '3px 8px',
                borderRadius: 4
              }}>
                STEP {step === 'details' ? '1 OF 2' : '2 OF 2'}
              </span>
              <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#f8fafc', fontWeight: 800 }}>
                {step === 'details' ? 'Passenger & Travel Details' : 'Secure Payment Checkout'}
              </h2>
            </div>
            <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: 4 }}>
              Reserving: <strong>{item.code}</strong> - {item.name} ({item.origin} ➔ {item.destination})
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isProcessing}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: 6
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '24px 28px', flex: 1 }}>
          {step === 'details' ? (
            <form onSubmit={handleProceedToPayment} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Hold Expiry Banner */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 16px',
                borderRadius: 10,
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                fontSize: '0.82rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#10b981', fontWeight: 700 }}>
                  <ShieldCheck size={16} />
                  BookGuard Atomic Lock Active
                </div>
                <div style={{ color: '#cbd5e1' }}>
                  Hold ID: <code>{hold?.holdId?.substring(0, 14)}...</code>
                </div>
              </div>

              {/* Form Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 700, marginBottom: 6 }}>
                    Full Legal Name (as per Govt ID) *
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: 10,
                      padding: '10px 14px',
                      color: '#f8fafc',
                      fontSize: '0.9rem',
                      outline: 'none'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 700, marginBottom: 6 }}>
                    Email Address (for E-Ticket) *
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: 10,
                      padding: '10px 14px',
                      color: '#f8fafc',
                      fontSize: '0.9rem',
                      outline: 'none'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 700, marginBottom: 6 }}>
                    Mobile Number (SMS Updates) *
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: 10,
                      padding: '10px 14px',
                      color: '#f8fafc',
                      fontSize: '0.9rem',
                      outline: 'none'
                    }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 700, marginBottom: 6 }}>
                      Age
                    </label>
                    <input
                      type="number"
                      value={age}
                      onChange={(e) => setAge(e.target.value)}
                      style={{
                        width: '100%',
                        background: 'rgba(15, 23, 42, 0.8)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        borderRadius: 10,
                        padding: '10px 14px',
                        color: '#f8fafc',
                        fontSize: '0.9rem',
                        outline: 'none'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 700, marginBottom: 6 }}>
                      Gender
                    </label>
                    <select
                      value={gender}
                      onChange={(e) => setGender(e.target.value)}
                      style={{
                        width: '100%',
                        background: 'rgba(15, 23, 42, 0.8)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        borderRadius: 10,
                        padding: '10px 14px',
                        color: '#f8fafc',
                        fontSize: '0.9rem',
                        outline: 'none'
                      }}
                    >
                      <option value="Female">Female</option>
                      <option value="Male">Male</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 700, marginBottom: 6 }}>
                    Seat / Berth Preference
                  </label>
                  <select
                    value={seatPreference}
                    onChange={(e) => setSeatPreference(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: 10,
                      padding: '10px 14px',
                      color: '#f8fafc',
                      fontSize: '0.9rem',
                      outline: 'none'
                    }}
                  >
                    <option value="Window Seat">Window Seat (Aviation)</option>
                    <option value="Aisle Seat">Aisle Seat</option>
                    <option value="Lower Berth">Lower Berth (IRCTC / Bus)</option>
                    <option value="Upper Berth">Upper Berth</option>
                    <option value="Ocean View Balcony">Ocean View (Hotel Room)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 700, marginBottom: 6 }}>
                    Govt ID Proof Type
                  </label>
                  <select
                    value={idType}
                    onChange={(e) => setIdType(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: 10,
                      padding: '10px 14px',
                      color: '#f8fafc',
                      fontSize: '0.9rem',
                      outline: 'none'
                    }}
                  >
                    <option value="Aadhaar Card">Aadhaar Card</option>
                    <option value="Passport">Passport</option>
                    <option value="Voter ID">Voter ID</option>
                    <option value="Driving License">Driving License</option>
                  </select>
                </div>
              </div>

              {/* Price Summary */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 14,
                padding: '16px 20px',
                marginTop: 8
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#94a3b8', marginBottom: 6 }}>
                  <span>Base Ticket Fare</span>
                  <span>₹{basePrice.toLocaleString('en-IN')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#94a3b8', marginBottom: 6 }}>
                  <span>GST & Airport/Station Toll (5%)</span>
                  <span>₹{taxAmount.toLocaleString('en-IN')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#10b981', fontWeight: 600, marginBottom: 12 }}>
                  <span>BookGuard Zero-Oversell Protection Guarantee</span>
                  <span>₹0.00 (Free)</span>
                </div>
                <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.1)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#f8fafc', fontWeight: 800, fontSize: '1rem' }}>Total Amount Payable</span>
                  <span style={{ color: '#38bdf8', fontWeight: 900, fontSize: '1.4rem' }}>
                    ₹{totalAmount.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>

              {/* Action Button */}
              <button
                type="submit"
                style={{
                  padding: '14px',
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '1rem',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  boxShadow: '0 4px 16px rgba(14, 165, 233, 0.35)'
                }}
              >
                <span>Proceed to Payment</span>
                <ArrowRight size={18} />
              </button>
            </form>
          ) : (
            /* STEP 2: PAYMENT GATEWAY */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Payment Methods Tabs */}
              <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: 10 }}>
                {[
                  { id: 'upi_qr', label: 'UPI QR Code', icon: <QrCode size={16} /> },
                  { id: 'upi_id', label: 'UPI ID / VPA', icon: <Smartphone size={16} /> },
                  { id: 'card', label: 'Credit / Debit Card', icon: <CreditCard size={16} /> },
                  { id: 'netbanking', label: 'Net Banking', icon: <Building size={16} /> }
                ].map(m => (
                  <button
                    key={m.id}
                    onClick={() => setPaymentMethod(m.id as any)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 14px',
                      borderRadius: 8,
                      background: paymentMethod === m.id ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                      border: paymentMethod === m.id ? '1px solid #38bdf8' : '1px solid transparent',
                      color: paymentMethod === m.id ? '#38bdf8' : '#94a3b8',
                      fontWeight: 700,
                      fontSize: '0.84rem',
                      cursor: 'pointer'
                    }}
                  >
                    {m.icon}
                    {m.label}
                  </button>
                ))}
              </div>

              {/* UPI QR Code Interface */}
              {paymentMethod === 'upi_qr' && (
                <div style={{
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 16,
                  padding: 24,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-around',
                  flexWrap: 'wrap',
                  gap: 20
                }}>
                  {/* Mock QR Code Graphic */}
                  <div style={{
                    width: 170,
                    height: 170,
                    background: '#fff',
                    borderRadius: 12,
                    padding: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                    position: 'relative'
                  }}>
                    <QrCode size={130} color="#000" />
                    <div style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      background: '#0ea5e9',
                      color: '#fff',
                      padding: '2px 6px',
                      borderRadius: 4,
                      fontSize: '0.6rem',
                      fontWeight: 900
                    }}>
                      UPI
                    </div>
                  </div>

                  <div style={{ maxWidth: 300 }}>
                    <div style={{ color: '#f8fafc', fontWeight: 800, fontSize: '1.1rem', marginBottom: 6 }}>
                      Scan & Pay with Any UPI App
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.5, marginBottom: 14 }}>
                      Scan using <strong>Google Pay, PhonePe, Paytm, or BHIM</strong>. Your payment is verified instantly with zero latency.
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <span style={{ background: 'rgba(255, 255, 255, 0.08)', color: '#cbd5e1', padding: '4px 8px', borderRadius: 4, fontSize: '0.75rem' }}>GPay</span>
                      <span style={{ background: 'rgba(255, 255, 255, 0.08)', color: '#cbd5e1', padding: '4px 8px', borderRadius: 4, fontSize: '0.75rem' }}>PhonePe</span>
                      <span style={{ background: 'rgba(255, 255, 255, 0.08)', color: '#cbd5e1', padding: '4px 8px', borderRadius: 4, fontSize: '0.75rem' }}>Paytm</span>
                    </div>
                  </div>
                </div>
              )}

              {/* UPI ID Input */}
              {paymentMethod === 'upi_id' && (
                <div style={{ padding: '16px 0' }}>
                  <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.82rem', fontWeight: 700, marginBottom: 6 }}>
                    Enter UPI ID / VPA
                  </label>
                  <input
                    type="text"
                    value={upiId}
                    onChange={(e) => setUpiId(e.target.value)}
                    placeholder="username@okhdfcbank"
                    style={{
                      width: '100%',
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: 10,
                      padding: '12px 14px',
                      color: '#f8fafc',
                      fontSize: '0.95rem',
                      outline: 'none'
                    }}
                  />
                  <div style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: 6 }}>
                    A collect request will be sent to your UPI mobile application.
                  </div>
                </div>
              )}

              {/* Card Input */}
              {paymentMethod === 'card' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 700, marginBottom: 6 }}>
                      Card Number
                    </label>
                    <input
                      type="text"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      style={{
                        width: '100%',
                        background: 'rgba(15, 23, 42, 0.8)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        borderRadius: 10,
                        padding: '10px 14px',
                        color: '#f8fafc',
                        fontSize: '0.9rem',
                        outline: 'none'
                      }}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 700, marginBottom: 6 }}>
                        Expiry (MM/YY)
                      </label>
                      <input
                        type="text"
                        value={cardExpiry}
                        onChange={(e) => setCardExpiry(e.target.value)}
                        style={{
                          width: '100%',
                          background: 'rgba(15, 23, 42, 0.8)',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          borderRadius: 10,
                          padding: '10px 14px',
                          color: '#f8fafc',
                          fontSize: '0.9rem',
                          outline: 'none'
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 700, marginBottom: 6 }}>
                        CVV / CVC
                      </label>
                      <input
                        type="password"
                        value={cardCvv}
                        onChange={(e) => setCardCvv(e.target.value)}
                        style={{
                          width: '100%',
                          background: 'rgba(15, 23, 42, 0.8)',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          borderRadius: 10,
                          padding: '10px 14px',
                          color: '#f8fafc',
                          fontSize: '0.9rem',
                          outline: 'none'
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* NetBanking */}
              {paymentMethod === 'netbanking' && (
                <div>
                  <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 700, marginBottom: 6 }}>
                    Select Your Bank
                  </label>
                  <select
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: 10,
                      padding: '12px 14px',
                      color: '#f8fafc',
                      fontSize: '0.95rem',
                      outline: 'none'
                    }}
                  >
                    <option value="HDFC Bank">HDFC Bank</option>
                    <option value="State Bank of India">State Bank of India (SBI)</option>
                    <option value="ICICI Bank">ICICI Bank</option>
                    <option value="Axis Bank">Axis Bank</option>
                    <option value="Kotak Mahindra Bank">Kotak Mahindra Bank</option>
                  </select>
                </div>
              )}

              {/* Bottom Buttons */}
              <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setStep('details')}
                  disabled={isProcessing}
                  style={{
                    padding: '14px 20px',
                    borderRadius: 12,
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#e2e8f0',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Back
                </button>

                <button
                  type="button"
                  onClick={handleFinalPayment}
                  disabled={isProcessing}
                  style={{
                    flex: 1,
                    padding: '14px',
                    borderRadius: 12,
                    background: isProcessing ? '#334155' : 'linear-gradient(135deg, #10b981, #059669)',
                    color: '#fff',
                    fontWeight: 900,
                    fontSize: '1rem',
                    border: 'none',
                    cursor: isProcessing ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    boxShadow: isProcessing ? 'none' : '0 6px 20px rgba(16, 185, 129, 0.4)'
                  }}
                >
                  <Lock size={16} />
                  {isProcessing ? 'Verifying with BookGuard Engine...' : `Pay ₹${totalAmount.toLocaleString('en-IN')} & Confirm Ticket`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
