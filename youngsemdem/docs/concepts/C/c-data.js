/* Direction C prototype: content copied from youngsemdem/data/quiz.js (organizerEra), events.js (first 3 DEMO
 * events) and levels.js (levels + 8 badges), EN + ES, on Mon Nov 9, 2026. Edit the source files there, not here.
 * Everything in events is DEMO (labelled on the page). Spanish still needs native-speaker review. */
window.YDSC_C_DATA = {
 "quiz": {
  "title": {
   "en": "What’s your organizer era?",
   "es": "¿En qué modo organizas tú?"
  },
  "intro": {
   "en": "8 quick questions. No wrong answers, and every type has a spot on the team.",
   "es": "8 preguntas rápidas. No hay respuestas incorrectas, y cada tipo tiene su lugar en el equipo."
  },
  "privacy": {
   "en": "We don’t save your answers. If you share, only your result goes with it.",
   "es": "No guardamos tus respuestas. Si compartes, solo se comparte tu resultado."
  },
  "copy": {
   "matchLabel": {
    "en": "Your organizer era",
    "es": "Tu modo"
   },
   "undertone": {
    "en": "{match}, with {undertone} undertones",
    "es": "{match}, con un toque de {undertone}"
   },
   "mixLabel": {
    "en": "Your mix",
    "es": "Tu mezcla"
   },
   "shareText": {
    "en": "I got {match} on the Young Dems organizer quiz. What’s yours?",
    "es": "Me salió {match} en el quiz de los Young Dems. ¿Y a ti?"
   }
  },
  "questions": [
   {
    "id": "friday",
    "prompt": {
     "en": "Friday night. Your ideal plan?",
     "es": "Viernes en la noche. ¿Tu plan ideal?"
    },
    "options": [
     {
      "label": {
       "en": "Wherever the music is loudest",
       "es": "Donde la música esté más alta"
      },
      "scores": {
       "hype": 2,
       "plusone": 1
      }
     },
     {
      "label": {
       "en": "Making the plan and sending the group a poll",
       "es": "Armar el plan y mandarle una encuesta al grupo"
      },
      "scores": {
       "chat": 2,
       "data": 1
      }
     },
     {
      "label": {
       "en": "A cozy night with a project (and a tracker for it)",
       "es": "Una noche tranquila con un proyecto (y su tabla de seguimiento)"
      },
      "scores": {
       "data": 2,
       "chat": 1
      }
     },
     {
      "label": {
       "en": "Walking downtown Sanford, talking to whoever",
       "es": "Caminar por el centro de Sanford, conversando con quien sea"
      },
      "scores": {
       "doors": 2,
       "hype": 1
      }
     },
     {
      "label": {
       "en": "Filming the whole night for my close friends",
       "es": "Grabar toda la noche para mis amistades cercanas"
      },
      "scores": {
       "creator": 2,
       "doors": 1
      }
     },
     {
      "label": {
       "en": "Bringing someone new to whatever we’re doing",
       "es": "Llevar a alguien nuevo a lo que sea que hagamos"
      },
      "scores": {
       "plusone": 2,
       "creator": 1
      }
     }
    ]
   },
   {
    "id": "chat-role",
    "prompt": {
     "en": "In the group chat, you’re the one who…",
     "es": "En el chat de grupo, tú eres quien…"
    },
    "options": [
     {
      "label": {
       "en": "Sends the “WE’RE GOING” text",
       "es": "Manda el “NOS VEMOS ALLÁ”"
      },
      "scores": {
       "hype": 2,
       "chat": 1
      }
     },
     {
      "label": {
       "en": "Remembers every deadline and birthday",
       "es": "Se acuerda de cada fecha límite y cada cumpleaños"
      },
      "scores": {
       "chat": 2,
       "data": 1
      }
     },
     {
      "label": {
       "en": "Makes the shared doc everyone ends up using",
       "es": "Hace el documento compartido que al final todo el mundo usa"
      },
      "scores": {
       "data": 2,
       "creator": 1
      }
     },
     {
      "label": {
       "en": "Would honestly rather just call",
       "es": "La verdad, prefiere llamar"
      },
      "scores": {
       "doors": 2,
       "plusone": 1
      }
     },
     {
      "label": {
       "en": "Posts the memes",
       "es": "Manda los memes"
      },
      "scores": {
       "creator": 2,
       "hype": 1
      }
     },
     {
      "label": {
       "en": "Keeps adding new people to the chat",
       "es": "Sigue agregando gente nueva al chat"
      },
      "scores": {
       "plusone": 2,
       "doors": 1
      }
     }
    ]
   },
   {
    "id": "directions",
    "prompt": {
     "en": "Someone on the Sanford Riverwalk asks you for directions. You…",
     "es": "Alguien en el Riverwalk de Sanford te pide indicaciones. Tú…"
    },
    "options": [
     {
      "label": {
       "en": "Walk them there and hype up downtown on the way",
       "es": "Vas con esa persona hasta allá y le recomiendas medio centro en el camino"
      },
      "scores": {
       "hype": 2,
       "doors": 1
      }
     },
     {
      "label": {
       "en": "Drop a pin, then send a backup pin",
       "es": "Mandas la ubicación, y luego una de respaldo"
      },
      "scores": {
       "chat": 2,
       "data": 1
      }
     },
     {
      "label": {
       "en": "Give the fastest route, the parking situation and the hours",
       "es": "Le das la ruta más rápida, dónde estacionar y el horario"
      },
      "scores": {
       "data": 2,
       "chat": 1
      }
     },
     {
      "label": {
       "en": "End up talking for 20 minutes",
       "es": "Terminan conversando 20 minutos"
      },
      "scores": {
       "doors": 2,
       "plusone": 1
      }
     },
     {
      "label": {
       "en": "Point out the best photo spot",
       "es": "Le dices cuál es el mejor lugar para fotos"
      },
      "scores": {
       "creator": 2,
       "hype": 1
      }
     },
     {
      "label": {
       "en": "Introduce them to a friend who lives nearby",
       "es": "Le presentas a una amistad que vive cerca"
      },
      "scores": {
       "plusone": 2,
       "creator": 1
      }
     }
    ]
   },
   {
    "id": "superpower",
    "prompt": {
     "en": "Pick a superpower.",
     "es": "Elige un superpoder."
    },
    "options": [
     {
      "label": {
       "en": "Making any room louder",
       "es": "Animar cualquier lugar"
      },
      "scores": {
       "hype": 2,
       "creator": 1
      }
     },
     {
      "label": {
       "en": "Never forgetting a date",
       "es": "Nunca olvidar una fecha"
      },
      "scores": {
       "chat": 2,
       "data": 1
      }
     },
     {
      "label": {
       "en": "Finding the pattern in any mess",
       "es": "Encontrar el patrón en cualquier desorden"
      },
      "scores": {
       "data": 2,
       "chat": 1
      }
     },
     {
      "label": {
       "en": "Getting anyone to open up",
       "es": "Lograr que cualquiera se abra contigo"
      },
      "scores": {
       "doors": 2,
       "plusone": 1
      }
     },
     {
      "label": {
       "en": "Turning 30 seconds into a story",
       "es": "Convertir 30 segundos en una historia"
      },
      "scores": {
       "creator": 2,
       "hype": 1
      }
     },
     {
      "label": {
       "en": "Knowing exactly who should meet who",
       "es": "Saber exactamente quién tiene que conocer a quién"
      },
      "scores": {
       "plusone": 2,
       "doors": 1
      }
     }
    ]
   },
   {
    "id": "app",
    "prompt": {
     "en": "Your most-used app is probably…",
     "es": "Tu app más usada probablemente es…"
    },
    "options": [
     {
      "label": {
       "en": "Music, always on",
       "es": "La música, siempre sonando"
      },
      "scores": {
       "hype": 2,
       "plusone": 1
      }
     },
     {
      "label": {
       "en": "Messages, obviously",
       "es": "Los mensajes, obvio"
      },
      "scores": {
       "chat": 2,
       "hype": 1
      }
     },
     {
      "label": {
       "en": "Notes and spreadsheets",
       "es": "Notas y hojas de cálculo"
      },
      "scores": {
       "data": 2,
       "chat": 1
      }
     },
     {
      "label": {
       "en": "Maps, because I’m always out",
       "es": "El mapa, porque siempre ando en la calle"
      },
      "scores": {
       "doors": 2,
       "data": 1
      }
     },
     {
      "label": {
       "en": "Camera, no contest",
       "es": "La cámara, sin duda"
      },
      "scores": {
       "creator": 2,
       "doors": 1
      }
     },
     {
      "label": {
       "en": "Contacts (it’s packed)",
       "es": "Los contactos (está lleno)"
      },
      "scores": {
       "plusone": 2,
       "creator": 1
      }
     }
    ]
   },
   {
    "id": "long-meeting",
    "prompt": {
     "en": "A meeting is running long. You’re…",
     "es": "Una reunión se está alargando. Tú estás…"
    },
    "options": [
     {
      "label": {
       "en": "Starting the slow clap to wrap it up",
       "es": "Empezando un aplauso lento para cerrar"
      },
      "scores": {
       "hype": 2,
       "creator": 1
      }
     },
     {
      "label": {
       "en": "Typing the recap for whoever left early",
       "es": "Escribiendo el resumen para quien se fue temprano"
      },
      "scores": {
       "chat": 2,
       "data": 1
      }
     },
     {
      "label": {
       "en": "Timing next week’s agenda so this never happens again",
       "es": "Midiendo la agenda de la próxima semana para que no vuelva a pasar"
      },
      "scores": {
       "data": 2,
       "chat": 1
      }
     },
     {
      "label": {
       "en": "Chatting with the new person by the snacks",
       "es": "Conversando con la persona nueva junto a la comida"
      },
      "scores": {
       "doors": 2,
       "plusone": 1
      }
     },
     {
      "label": {
       "en": "Getting a clip of the best moment",
       "es": "Grabando el mejor momento"
      },
      "scores": {
       "creator": 2,
       "hype": 1
      }
     },
     {
      "label": {
       "en": "Making sure the new person has a ride home",
       "es": "Asegurándote de que la persona nueva tenga cómo volver a casa"
      },
      "scores": {
       "plusone": 2,
       "doors": 1
      }
     }
    ]
   },
   {
    "id": "potluck",
    "prompt": {
     "en": "Potluck at the park. What are you bringing?",
     "es": "Comida compartida en el parque. ¿Qué llevas?"
    },
    "options": [
     {
      "label": {
       "en": "The speaker and the playlist",
       "es": "La música y el altavoz"
      },
      "scores": {
       "hype": 2,
       "plusone": 1
      }
     },
     {
      "label": {
       "en": "The sign-up sheet, so we don’t end up with six bags of chips",
       "es": "La lista de quién trae qué, para no terminar con seis bolsas de papas"
      },
      "scores": {
       "chat": 2,
       "data": 1
      }
     },
     {
      "label": {
       "en": "A labeled dish with the ingredients listed",
       "es": "Un plato con etiqueta y la lista de ingredientes"
      },
      "scores": {
       "data": 2,
       "chat": 1
      }
     },
     {
      "label": {
       "en": "Myself. I’m here to talk to people",
       "es": "A mí. Vengo a conversar con la gente"
      },
      "scores": {
       "doors": 2,
       "hype": 1
      }
     },
     {
      "label": {
       "en": "The dish that looks amazing on camera",
       "es": "El plato que se ve increíble en cámara"
      },
      "scores": {
       "creator": 2,
       "doors": 1
      }
     },
     {
      "label": {
       "en": "Two extra friends (and two extra chairs)",
       "es": "Dos amistades más (y dos sillas más)"
      },
      "scores": {
       "plusone": 2,
       "creator": 1
      }
     }
    ]
   },
   {
    "id": "proudest",
    "prompt": {
     "en": "After a big day, what makes you proudest?",
     "es": "Después de un gran día, ¿qué te da más orgullo?"
    },
    "options": [
     {
      "label": {
       "en": "The room was packed and loud",
       "es": "El lugar se llenó y hubo muy buen ambiente"
      },
      "scores": {
       "hype": 2,
       "plusone": 1
      }
     },
     {
      "label": {
       "en": "Everyone showed up on time because of my reminders",
       "es": "Todo el mundo llegó a tiempo gracias a mis recordatorios"
      },
      "scores": {
       "chat": 2,
       "data": 1
      }
     },
     {
      "label": {
       "en": "The numbers added up, and we can show our work",
       "es": "Los números cuadraron, y podemos demostrarlo"
      },
      "scores": {
       "data": 2,
       "chat": 1
      }
     },
     {
      "label": {
       "en": "A neighbor I just met said they’d come next time",
       "es": "Alguien del barrio que acabo de conocer dijo que vendrá la próxima vez"
      },
      "scores": {
       "doors": 2,
       "hype": 1
      }
     },
     {
      "label": {
       "en": "The recap video ended up in group chats all over the county",
       "es": "El video resumen terminó en chats de grupo por todo el condado"
      },
      "scores": {
       "creator": 2,
       "doors": 1
      }
     },
     {
      "label": {
       "en": "Three friends came because I asked",
       "es": "Vinieron tres amistades gracias a mi invitación"
      },
      "scores": {
       "plusone": 2,
       "creator": 1
      }
     }
    ]
   }
  ],
  "results": [
   {
    "id": "hype",
    "color": "celery",
    "name": {
     "en": "The Hype Captain",
     "es": "La Chispa"
    },
    "headline": {
     "en": "I’m the Hype Captain.",
     "es": "Soy La Chispa."
    },
    "subline": {
     "en": "I bring the energy. You bring a friend.",
     "es": "Yo pongo la energía. Tú traes a alguien."
    },
    "desc": {
     "en": [
      "You walk in and the room gets louder, in a good way.",
      "People come because they know you’ll be there."
     ],
     "es": [
      "Llegas y el ambiente se anima, para bien.",
      "La gente viene porque sabe que vas a estar."
     ]
    },
    "action": {
     "en": "Find a room to fill",
     "es": "Busca un evento para animar"
    }
   },
   {
    "id": "chat",
    "color": "sky",
    "name": {
     "en": "The Group-Chat General",
     "es": "Modo Admin"
    },
    "headline": {
     "en": "I’m the Group-Chat General.",
     "es": "Estoy en Modo Admin."
    },
    "subline": {
     "en": "If I texted you a deadline, it’s real.",
     "es": "Si te mandé una fecha, va en serio."
    },
    "desc": {
     "en": [
      "You know every deadline, every birthday and who still owes $12 for pizza.",
      "When you say “leaving in 10,” people actually leave in 10."
     ],
     "es": [
      "Te sabes cada fecha límite, cada cumpleaños y quién todavía debe $12 de la pizza.",
      "Cuando dices “salimos en 10”, la gente de verdad sale en 10."
     ]
    },
    "action": {
     "en": "Text 3 friends about the Dec 31 deadline",
     "es": "Avísales a 3 amistades de la fecha del 31 de diciembre"
    }
   },
   {
    "id": "data",
    "color": "violet",
    "name": {
     "en": "The Spreadsheet Witch",
     "es": "Magia en Celdas"
    },
    "headline": {
     "en": "I’m the Spreadsheet Witch.",
     "es": "Lo mío es Magia en Celdas."
    },
    "subline": {
     "en": "Give me chaos. I’ll give you a tracker.",
     "es": "Dame el caos y te devuelvo una tabla."
    },
    "desc": {
     "en": [
      "You color-code for fun, and your formulas have never once broken.",
      "Chaos walks in. A clean tracker walks out."
     ],
     "es": [
      "Organizas por colores porque te divierte, y tus fórmulas nunca fallan.",
      "Entra el caos. Sale una tabla impecable."
     ]
    },
    "action": {
     "en": "Help run RSVPs and sign-ins",
     "es": "Ayuda con las confirmaciones y la lista de asistencia"
    }
   },
   {
    "id": "doors",
    "color": "orange",
    "name": {
     "en": "The Door-Knock Natural",
     "es": "Toc, Toc"
    },
    "headline": {
     "en": "I’m a Door-Knock Natural.",
     "es": "Toc, toc: soy yo."
    },
    "subline": {
     "en": "Talking to neighbors? Honestly my favorite part.",
     "es": "¿Hablar con los vecinos? Lo mejor del día."
    },
    "desc": {
     "en": [
      "You can talk to anyone, and somehow they end up telling you their whole story.",
      "Neighbors remember your name. You remember their dog’s."
     ],
     "es": [
      "Hablas con cualquiera, y de alguna forma terminan contándote su vida.",
      "Los vecinos se acuerdan de tu nombre. Tú, del nombre de su perro."
     ]
    },
    "action": {
     "en": "Try a door-knocking training (no experience needed)",
     "es": "Prueba un taller de puerta a puerta (no hace falta experiencia)"
    }
   },
   {
    "id": "creator",
    "color": "bubblegum",
    "name": {
     "en": "The Creator",
     "es": "Luces, Cámara, Acción"
    },
    "headline": {
     "en": "I’m the Creator.",
     "es": "Lo mío es luces, cámara, acción."
    },
    "subline": {
     "en": "Hit record. Keep it local.",
     "es": "Grabo lo que pasa aquí."
    },
    "desc": {
     "en": [
      "You can turn 30 seconds of a Tuesday meeting into something people actually watch.",
      "Your camera roll is mostly B-roll, and you’re not sorry."
     ],
     "es": [
      "Conviertes 30 segundos de una reunión de martes en algo que la gente sí quiere ver.",
      "Tu galería está llena de tomas “por si acaso”, y no te arrepientes."
     ]
    },
    "action": {
     "en": "Post a 60-second take",
     "es": "Sube un video de 60 segundos"
    }
   },
   {
    "id": "plusone",
    "color": "teal",
    "name": {
     "en": "The Plus-One",
     "es": "Conoce a Medio Mundo"
    },
    "headline": {
     "en": "I’m the Plus-One.",
     "es": "Conozco a medio mundo."
    },
    "subline": {
     "en": "Wherever I go, I’m bringing you.",
     "es": "Y a donde voy, te llevo."
    },
    "desc": {
     "en": [
      "You never show up alone, and nobody you bring ever regrets it.",
      "Half your friends met each other because of you."
     ],
     "es": [
      "Nunca llegas sin compañía, y nadie que llevas se arrepiente.",
      "La mitad de tus amistades se conocieron gracias a ti."
     ]
    },
    "action": {
     "en": "Join and share your invite link",
     "es": "Únete y comparte tu enlace de invitación"
    }
   }
  ]
 },
 "events": [
  {
   "id": "sunset-walk-lake-monroe",
   "title": {
    "en": "Sunset walk-and-talk on Lake Monroe",
    "es": "Caminata al atardecer en el lago Monroe"
   },
   "tagline": {
    "en": "However Nov 3 landed for you, come walk it off with us.",
    "es": "Te haya ido como te haya ido el 3 de noviembre, ven a caminar con nosotros."
   },
   "when": {
    "en": "Sat, Nov 14, 4:45 to 6:15 pm",
    "es": "Sáb., 14 de nov., de 4:45 a 6:15 p. m."
   },
   "start": "2026-11-14T16:45:00-05:00",
   "end": "2026-11-14T18:15:00-05:00",
   "place": {
    "en": "Veterans Memorial Park on the Sanford Riverwalk",
    "es": "Veterans Memorial Park, en el Riverwalk de Sanford"
   },
   "city": "sanford",
   "vibes": [
    {
     "en": "Outdoors",
     "es": "Al aire libre"
    },
    {
     "en": "Real talk",
     "es": "Para conversar en serio"
    },
    {
     "en": "Low-key",
     "es": "Tranquilo"
    },
    {
     "en": "First-timer friendly",
     "es": "Ideal si es tu primera vez"
    }
   ],
   "access": {
    "en": "Slow pace, lots of stops. A few of us hold a bench at the start the whole time, so you can join the talk without the walk. Tell us what you need when you RSVP and we'll plan around it.",
    "es": "Paso lento y muchas pausas. Algunos nos quedamos todo el tiempo en una banca al inicio, así que puedes sumarte a la conversación sin caminar. Cuéntanos qué necesitas al confirmar y lo planeamos."
   },
   "cost": {
    "en": "Free",
    "es": "Gratis"
   },
   "going": 23,
   "capacity": 40,
   "share": {
    "en": "Sunset walk on Lake Monroe, Sat Nov 14, 4:45 pm. Free, no speeches, just a walk and a real talk about what's next. Come with me? {url}",
    "es": "Caminata al atardecer en el lago Monroe, sáb. 14 de nov., 4:45 p. m. Gratis y sin discursos: solo caminar y hablar en serio de lo que viene. ¿Vienes conmigo? {url}"
   },
   "cal": {
    "en": "Demo event. Slow walk on the Sanford Riverwalk at sunset (about 5:32 pm), plus a no-pressure talk about Nov 3 and 2027. Free, 14 and up, alcohol-free.",
    "es": "Evento de muestra. Caminata tranquila por el Riverwalk de Sanford al atardecer (cerca de las 5:32 p. m.) y una conversación sin presión sobre el 3 de noviembre y 2027. Gratis, desde 14 años, sin alcohol."
   },
   "tone": "calm",
   "afterDark": true
  },
  {
   "id": "trivia-how-seminole-are-you",
   "title": {
    "en": "Trivia night: how Seminole are you?",
    "es": "Noche de trivia: ¿qué tan de Seminole eres?"
   },
   "tagline": {
    "en": "Seven cities, four SunRail stops, one very old tree. Bring a team or join one.",
    "es": "Siete ciudades, cuatro estaciones de SunRail y un árbol muy, muy viejo. Trae tu equipo o únete a uno."
   },
   "when": {
    "en": "Thu, Nov 19, 7 to 9 pm",
    "es": "Jue., 19 de nov., de 7 a 9 p. m."
   },
   "start": "2026-11-19T19:00:00-05:00",
   "end": "2026-11-19T21:00:00-05:00",
   "place": {
    "en": "A board-game café in Casselberry (demo venue)",
    "es": "Un café de juegos de mesa en Casselberry (lugar de muestra)"
   },
   "city": "casselberry",
   "vibes": [
    {
     "en": "Games",
     "es": "Juegos"
    },
    {
     "en": "Meet people",
     "es": "Para conocer gente"
    },
    {
     "en": "First-timer friendly",
     "es": "Ideal si es tu primera vez"
    }
   ],
   "access": {
    "en": "Questions are read out loud and shown on a screen. Large-print answer sheets on request. A quieter table in the back if the room gets loud.",
    "es": "Las preguntas se leen en voz alta y salen en pantalla. Hojas de respuestas en letra grande si las pides. Hay una mesa más tranquila al fondo por si hay mucho ruido."
   },
   "cost": {
    "en": "Free to play",
    "es": "Jugar es gratis"
   },
   "going": 31,
   "capacity": 48,
   "share": {
    "en": "Trivia night about Seminole County, Thu Nov 19, 7 pm in Casselberry. Free. I need a teammate who knows things. {url}",
    "es": "Noche de trivia sobre el condado de Seminole, jue. 19 de nov., 7 p. m., en Casselberry. Gratis. Necesito a alguien en mi equipo que sepa cosas. {url}"
   },
   "cal": {
    "en": "Demo event. Seminole County trivia, teams of up to 6, solo players welcome. Free, 14 and up, alcohol-free.",
    "es": "Evento de muestra. Trivia sobre el condado de Seminole, equipos de hasta 6, también si vienes sin equipo. Gratis, desde 14 años, sin alcohol."
   },
   "tone": "fun",
   "afterDark": true
  },
  {
   "id": "text-bank-dec-31-heads-up",
   "title": {
    "en": "Text bank: the Dec 31 heads-up",
    "es": "Jornada de mensajes: el aviso del 31 de diciembre"
   },
   "tagline": {
    "en": "Two hours, a laptop or phone, and a friendly script. So nobody gets surprised in 2027.",
    "es": "Dos horas, tu laptop o tu celular y un guion amable. Para que nadie se lleve una sorpresa en 2027."
   },
   "when": {
    "en": "Tue, Dec 1, 6:30 to 8:30 pm",
    "es": "Mar., 1 de dic., de 6:30 a 8:30 p. m."
   },
   "start": "2026-12-01T18:30:00-05:00",
   "end": "2026-12-01T20:30:00-05:00",
   "place": {
    "en": "A coworking room in Lake Mary (demo venue), or from your couch",
    "es": "Una sala de coworking en Lake Mary (lugar de muestra), o desde tu sofá"
   },
   "city": "lake-mary",
   "vibes": [
    {
     "en": "Volunteer shift",
     "es": "Turno de voluntariado"
    },
    {
     "en": "Remote option",
     "es": "Opción a distancia"
    },
    {
     "en": "First-timer friendly",
     "es": "Ideal si es tu primera vez"
    }
   ],
   "access": {
    "en": "Join from home if getting here is hard. The training call has captions on. Take a break whenever you want one.",
    "es": "Conéctate desde casa si te cuesta llegar. La llamada de entrenamiento tiene subtítulos activados. Toma un descanso cuando quieras."
   },
   "cost": {
    "en": "Free, snacks for the in-person crew",
    "es": "Gratis, con algo para picar para quienes vengan en persona"
   },
   "going": 14,
   "capacity": 25,
   "share": {
    "en": "Text bank Tue Dec 1, 6:30 pm: two hours telling Seminole voters their mail-ballot request runs out Dec 31. In Lake Mary or from your couch. Join me? {url}",
    "es": "Jornada de mensajes el mar. 1 de dic., 6:30 p. m.: dos horas avisándoles a votantes de Seminole que su solicitud de boleta por correo vence el 31 de diciembre. En Lake Mary o desde tu sofá. ¿Te sumas? {url}"
   },
   "cal": {
    "en": "Demo event. Text bank about Florida's Dec 31 mail-ballot request expiry. 15-minute training, in person in Lake Mary or remote. Free.",
    "es": "Evento de muestra. Jornada de mensajes sobre el vencimiento de las solicitudes de boleta por correo el 31 de diciembre. Entrenamiento de 15 minutos, en persona en Lake Mary o a distancia. Gratis."
   },
   "tone": "fun",
   "afterDark": true
  }
 ],
 "levels": {
  "levels": [
   {
    "id": "seed",
    "name": {
     "en": "Seed",
     "es": "Semilla"
    },
    "minXp": 0,
    "perk": {
     "en": "A welcome sticker at your first event",
     "es": "Un sticker de bienvenida en tu primer evento"
    }
   },
   {
    "id": "sprout",
    "name": {
     "en": "Sprout",
     "es": "Brote"
    },
    "minXp": 100,
    "perk": {
     "en": "First pick from the sticker sheet",
     "es": "Escoges primero de la hoja de stickers"
    }
   },
   {
    "id": "sapling",
    "name": {
     "en": "Sapling",
     "es": "Arbolito"
    },
    "minXp": 300,
    "perk": {
     "en": "Pick a round topic at trivia night",
     "es": "Escoges el tema de una ronda en la noche de trivia"
    }
   },
   {
    "id": "cypress",
    "name": {
     "en": "Cypress",
     "es": "Ciprés"
    },
    "minXp": 700,
    "perk": {
     "en": "Choose one of the Picks in the Thursday Letter",
     "es": "Escoges una de las recomendaciones de La Carta del Jueves"
    }
   },
   {
    "id": "phoenix",
    "name": {
     "en": "Phoenix",
     "es": "Fénix"
    },
    "minXp": 1400,
    "perk": {
     "en": "Co-host an event with us, or write a Guest Letter",
     "es": "Organizas un evento con nosotros o escribes una carta invitada"
    }
   }
  ],
  "badges": [
   {
    "id": "doors-open",
    "name": {
     "en": "Doors Open",
     "es": "Puertas abiertas"
    },
    "desc": {
     "en": "Your first event. The rest is easier.",
     "es": "Tu primer evento. Lo demás es más fácil."
    }
   },
   {
    "id": "plus-one",
    "name": {
     "en": "Plus-One",
     "es": "Trajiste a alguien"
    },
    "desc": {
     "en": "Someone joined because you asked. That's the whole game.",
     "es": "Alguien se unió porque tú le pediste. De eso se trata todo."
    }
   },
   {
    "id": "squad-of-three",
    "name": {
     "en": "Squad of Three",
     "es": "Grupo de tres"
    },
    "desc": {
     "en": "Three friends in. You're the group chat's favorite person.",
     "es": "Tres amistades adentro. Eres la persona favorita del chat."
    }
   },
   {
    "id": "renew-ready",
    "name": {
     "en": "Renew-Ready",
     "es": "Lista la renovación"
    },
    "desc": {
     "en": "Your Jan 1 reminder is set. Future you says thanks.",
     "es": "Tu recordatorio del 1 de enero está listo. Tu yo del futuro te lo agradece."
    }
   },
   {
    "id": "plan-made",
    "name": {
     "en": "Plan Made",
     "es": "Plan hecho"
    },
    "desc": {
     "en": "When, how and who you're going with. Done.",
     "es": "Cuándo, cómo y con quién vas. Listo."
    }
   },
   {
    "id": "golden-hour",
    "name": {
     "en": "Golden Hour",
     "es": "Hora dorada"
    },
    "desc": {
     "en": "Sunset on Lake Monroe, in good company.",
     "es": "Atardecer en el lago Monroe, en buena compañía."
    }
   },
   {
    "id": "on-camera",
    "name": {
     "en": "On Camera",
     "es": "En cámara"
    },
    "desc": {
     "en": "Your 60 seconds are live. Someone needed to hear it.",
     "es": "Tus 60 segundos ya están publicados. Alguien necesitaba escucharlo."
    }
   },
   {
    "id": "card-carrier",
    "name": {
     "en": "Card Carrier",
     "es": "Con carné"
    },
    "desc": {
     "en": "You picked your membership. Voting or non-voting, it counts the same here.",
     "es": "Escogiste tu membresía. Con voto o sin voto, aquí cuenta igual."
    }
   }
  ]
 }
};
