'use client';

import { useState, useEffect, useRef } from 'react';
import SimplePeer from 'simple-peer';
import { saveMessage, getMessages, saveContact, getContacts } from '@/lib/db';
import { createPeerConnection, sendMessage as sendP2PMessage } from '@/lib/p2p';

interface Message {
  id: string;
  sender: string;
  receiver: string;
  text: string;
  timestamp: number;
  synced: boolean;
}

interface Contact {
  id: string;
  name: string;
  lastSeen: number;
}

export default function Home() {
  const [username, setUsername] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [showAddContact, setShowAddContact] = useState(false);

  // P2P & WebRTC
  const [peer, setPeer] = useState<SimplePeer.Instance | null>(null);
  const [signalData, setSignalData] = useState('');
  const [receivedSignal, setReceivedSignal] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [showSignalModal, setShowSignalModal] = useState(false);

  // Calling
  const [inCall, setInCall] = useState(false);
  const [callType, setCallType] = useState<'audio' | 'video' | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isLoggedIn) {
      loadContacts();
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (selectedContact) {
      loadMessages();
    }
  }, [selectedContact]);

  const loadContacts = async () => {
    const loadedContacts = await getContacts();
    setContacts(loadedContacts);
  };

  const loadMessages = async () => {
    if (!selectedContact) return;
    const loadedMessages = await getMessages(username, selectedContact.id);
    setMessages(loadedMessages);
  };

  const handleLogin = () => {
    if (username.trim()) {
      setIsLoggedIn(true);
      localStorage.setItem('messenger-username', username);
    }
  };

  const handleAddContact = async () => {
    if (newContactName.trim()) {
      const contact: Contact = {
        id: newContactName,
        name: newContactName,
        lastSeen: Date.now()
      };
      await saveContact(contact);
      await loadContacts();
      setNewContactName('');
      setShowAddContact(false);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedContact) return;

    const message: Message = {
      id: `${Date.now()}-${Math.random()}`,
      sender: username,
      receiver: selectedContact.id,
      text: newMessage,
      timestamp: Date.now(),
      synced: false
    };

    await saveMessage(message);
    setMessages([...messages, message]);
    setNewMessage('');

    // Try to send via P2P if connected
    if (peer && isConnected) {
      try {
        sendP2PMessage(peer, JSON.stringify(message));
        message.synced = true;
        await saveMessage(message);
      } catch (err) {
        console.log('P2P send failed, message saved offline');
      }
    }
  };

  const initializePeer = (initiator: boolean) => {
    const newPeer = createPeerConnection(
      initiator,
      (signal) => {
        setSignalData(JSON.stringify(signal));
        setShowSignalModal(true);
      },
      (data) => {
        try {
          const receivedMsg = JSON.parse(data);
          if (receivedMsg.text) {
            saveMessage(receivedMsg);
            if (selectedContact &&
                (receivedMsg.sender === selectedContact.id || receivedMsg.receiver === selectedContact.id)) {
              loadMessages();
            }
          }
        } catch (err) {
          console.error('Error parsing received data:', err);
        }
      },
      (stream) => {
        setRemoteStream(stream);
      }
    );

    newPeer.on('connect', () => {
      setIsConnected(true);
      console.log('P2P Connected!');
    });

    newPeer.on('close', () => {
      setIsConnected(false);
      endCall();
    });

    setPeer(newPeer);
  };

  const handleConnect = () => {
    initializePeer(true);
  };

  const handleAcceptSignal = () => {
    if (!receivedSignal) return;

    try {
      const signal = JSON.parse(receivedSignal);
      if (peer) {
        peer.signal(signal);
        setShowSignalModal(false);
      } else {
        const newPeer = createPeerConnection(
          false,
          (sig) => {
            setSignalData(JSON.stringify(sig));
          },
          (data) => {
            try {
              const receivedMsg = JSON.parse(data);
              if (receivedMsg.text) {
                saveMessage(receivedMsg);
                loadMessages();
              }
            } catch (err) {
              console.error('Error parsing received data:', err);
            }
          },
          (stream) => {
            setRemoteStream(stream);
          }
        );

        newPeer.on('connect', () => {
          setIsConnected(true);
        });

        newPeer.on('close', () => {
          setIsConnected(false);
          endCall();
        });

        setPeer(newPeer);
        newPeer.signal(signal);
        setShowSignalModal(false);
      }
    } catch (err) {
      alert('Invalid signal data');
    }
  };

  const startCall = async (type: 'audio' | 'video') => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: type === 'video',
        audio: true
      });

      setLocalStream(stream);
      setCallType(type);
      setInCall(true);

      if (peer && isConnected) {
        peer.addStream(stream);
      } else {
        const newPeer = createPeerConnection(
          true,
          (signal) => {
            setSignalData(JSON.stringify(signal));
            setShowSignalModal(true);
          },
          (data) => {
            try {
              const receivedMsg = JSON.parse(data);
              if (receivedMsg.text) {
                saveMessage(receivedMsg);
                loadMessages();
              }
            } catch (err) {
              console.error('Error parsing received data:', err);
            }
          },
          (remoteStream) => {
            setRemoteStream(remoteStream);
          }
        );

        newPeer.on('connect', () => {
          setIsConnected(true);
        });

        newPeer.on('close', () => {
          setIsConnected(false);
          endCall();
        });

        newPeer.addStream(stream);
        setPeer(newPeer);
      }
    } catch (err) {
      console.error('Error accessing media devices:', err);
      alert('Cannot access camera/microphone. Please check permissions.');
    }
  };

  const endCall = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    if (remoteStream) {
      remoteStream.getTracks().forEach(track => track.stop());
      setRemoteStream(null);
    }
    setInCall(false);
    setCallType(null);
  };

  if (!isLoggedIn) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-500 to-purple-600">
        <div className="bg-white p-8 rounded-2xl shadow-2xl w-96">
          <h1 className="text-3xl font-bold text-center mb-6 text-gray-800">অফলাইন মেসেঞ্জার</h1>
          <input
            type="text"
            placeholder="আপনার নাম লিখুন"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
            className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg mb-4 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleLogin}
            className="w-full bg-blue-500 text-white py-3 rounded-lg font-semibold hover:bg-blue-600 transition"
          >
            প্রবেশ করুন
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 bg-blue-500 text-white">
          <h2 className="text-xl font-bold">{username}</h2>
          <div className="flex items-center mt-2 text-sm">
            <div className={`w-2 h-2 rounded-full mr-2 ${isConnected ? 'bg-green-400' : 'bg-red-400'}`}></div>
            {isConnected ? 'সংযুক্ত' : 'অসংযুক্ত'}
          </div>
        </div>

        <div className="p-3 border-b border-gray-200">
          <button
            onClick={() => setShowAddContact(true)}
            className="w-full bg-blue-500 text-white py-2 rounded-lg hover:bg-blue-600 transition"
          >
            + নতুন যোগাযোগ যোগ করুন
          </button>
          <button
            onClick={handleConnect}
            className="w-full bg-green-500 text-white py-2 rounded-lg hover:bg-green-600 transition mt-2"
          >
            P2P সংযোগ শুরু করুন
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {contacts.map((contact) => (
            <div
              key={contact.id}
              onClick={() => setSelectedContact(contact)}
              className={`p-4 border-b border-gray-200 cursor-pointer hover:bg-gray-50 transition ${
                selectedContact?.id === contact.id ? 'bg-blue-50' : ''
              }`}
            >
              <div className="font-semibold">{contact.name}</div>
              <div className="text-sm text-gray-500">ট্যাপ করে চ্যাট করুন</div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {selectedContact ? (
          <>
            <div className="p-4 bg-white border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-xl font-bold">{selectedContact.name}</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => startCall('audio')}
                  disabled={inCall}
                  className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition disabled:bg-gray-400"
                >
                  📞 অডিও কল
                </button>
                <button
                  onClick={() => startCall('video')}
                  disabled={inCall}
                  className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition disabled:bg-gray-400"
                >
                  📹 ভিডিও কল
                </button>
                {inCall && (
                  <button
                    onClick={endCall}
                    className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition"
                  >
                    ❌ কল শেষ করুন
                  </button>
                )}
              </div>
            </div>

            {inCall && (
              <div className="bg-gray-900 p-4 grid grid-cols-2 gap-4">
                {callType === 'video' && (
                  <>
                    <div className="relative">
                      <video
                        ref={localVideoRef}
                        autoPlay
                        muted
                        playsInline
                        className="w-full h-48 bg-black rounded-lg"
                      />
                      <div className="absolute bottom-2 left-2 text-white text-sm bg-black bg-opacity-50 px-2 py-1 rounded">
                        আপনি
                      </div>
                    </div>
                    <div className="relative">
                      <video
                        ref={remoteVideoRef}
                        autoPlay
                        playsInline
                        className="w-full h-48 bg-black rounded-lg"
                      />
                      <div className="absolute bottom-2 left-2 text-white text-sm bg-black bg-opacity-50 px-2 py-1 rounded">
                        {selectedContact.name}
                      </div>
                    </div>
                  </>
                )}
                {callType === 'audio' && (
                  <div className="col-span-2 flex items-center justify-center h-48 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg">
                    <div className="text-white text-center">
                      <div className="text-6xl mb-4">🎵</div>
                      <div className="text-xl">অডিও কল চলছে...</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`mb-4 flex ${msg.sender === username ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-xs px-4 py-2 rounded-2xl ${
                      msg.sender === username
                        ? 'bg-blue-500 text-white'
                        : 'bg-white text-gray-800'
                    }`}
                  >
                    <div>{msg.text}</div>
                    <div className={`text-xs mt-1 ${msg.sender === username ? 'text-blue-100' : 'text-gray-500'}`}>
                      {new Date(msg.timestamp).toLocaleTimeString('bn-BD')}
                      {msg.sender === username && (msg.synced ? ' ✓✓' : ' ✓')}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 bg-white border-t border-gray-200">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="মেসেজ লিখুন..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={handleSendMessage}
                  className="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 transition font-semibold"
                >
                  পাঠান
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-xl">
            চ্যাট শুরু করতে একটি যোগাযোগ নির্বাচন করুন
          </div>
        )}
      </div>

      {/* Add Contact Modal */}
      {showAddContact && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-2xl shadow-2xl w-96">
            <h3 className="text-2xl font-bold mb-4">নতুন যোগাযোগ যোগ করুন</h3>
            <input
              type="text"
              placeholder="যোগাযোগের নাম"
              value={newContactName}
              onChange={(e) => setNewContactName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddContact()}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg mb-4 focus:outline-none focus:border-blue-500"
            />
            <div className="flex gap-2">
              <button
                onClick={handleAddContact}
                className="flex-1 bg-blue-500 text-white py-2 rounded-lg hover:bg-blue-600 transition"
              >
                যোগ করুন
              </button>
              <button
                onClick={() => {
                  setShowAddContact(false);
                  setNewContactName('');
                }}
                className="flex-1 bg-gray-300 text-gray-800 py-2 rounded-lg hover:bg-gray-400 transition"
              >
                বাতিল করুন
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Signal Exchange Modal */}
      {showSignalModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-2xl shadow-2xl w-[600px] max-h-[80vh] overflow-y-auto">
            <h3 className="text-2xl font-bold mb-4">P2P সংযোগ সিগন্যাল</h3>

            <div className="mb-4">
              <label className="block font-semibold mb-2">আপনার সিগন্যাল (কপি করুন এবং অন্যকে পাঠান):</label>
              <textarea
                readOnly
                value={signalData}
                className="w-full h-32 px-3 py-2 border-2 border-gray-300 rounded-lg font-mono text-xs"
                onClick={(e) => {
                  e.currentTarget.select();
                  navigator.clipboard.writeText(signalData);
                }}
              />
            </div>

            <div className="mb-4">
              <label className="block font-semibold mb-2">প্রাপ্ত সিগন্যাল (অন্যের সিগন্যাল পেস্ট করুন):</label>
              <textarea
                value={receivedSignal}
                onChange={(e) => setReceivedSignal(e.target.value)}
                placeholder="অন্যের সিগন্যাল এখানে পেস্ট করুন"
                className="w-full h-32 px-3 py-2 border-2 border-gray-300 rounded-lg font-mono text-xs"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleAcceptSignal}
                className="flex-1 bg-blue-500 text-white py-2 rounded-lg hover:bg-blue-600 transition"
              >
                সংযোগ করুন
              </button>
              <button
                onClick={() => setShowSignalModal(false)}
                className="flex-1 bg-gray-300 text-gray-800 py-2 rounded-lg hover:bg-gray-400 transition"
              >
                বন্ধ করুন
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
