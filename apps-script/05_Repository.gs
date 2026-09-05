function buildUserSchedule_(userSlug, semesterId, providedDatabase) {
  const database = providedDatabase || loadDatabase_();
  assertDatabaseIntegrity_(database);

  const activeUsers = database.Users.filter(function (row) {
    return isActive_(row.active);
  });
  const user = activeUsers.find(function (row) {
    return row.slug === userSlug;
  });
  if (!user)
    throw schedulerError_(
      'USER_NOT_FOUND',
      'Unknown or inactive user: ' + userSlug,
    );

  const targetSemesterId = semesterId || getCurrentSemesterId_(database);
  const semester = database.Semesters.find(function (row) {
    return row.semester_id === targetSemesterId;
  });
  if (!semester)
    throw schedulerError_(
      'SEMESTER_NOT_FOUND',
      'Unknown or inactive semester: ' + targetSemesterId,
    );

  const offeringById = {};
  database.Offerings.forEach(function (row) {
    offeringById[row.offering_id] = row;
  });
  const subjectById = {};
  database.Subjects.forEach(function (row) {
    subjectById[row.subject_id] = row;
  });
  const groupById = {};
  database.Groups.forEach(function (row) {
    groupById[row.group_id] = row;
  });
  const activeUserById = {};
  activeUsers.forEach(function (row) {
    activeUserById[row.user_id] = row;
  });

  const enrollments = database.Enrollments.filter(function (row) {
    const offering = offeringById[row.offering_id];
    return (
      row.user_id === user.user_id &&
      isActive_(row.active) &&
      offering &&
      offering.semester_id === semester.semester_id &&
      isActive_(offering.active)
    );
  });
  const enrollmentByOffering = {};
  enrollments.forEach(function (row) {
    enrollmentByOffering[row.offering_id] = row;
  });

  const subjects = enrollments
    .map(function (enrollment) {
      const offering = offeringById[enrollment.offering_id];
      const subject = subjectById[offering.subject_id];
      const selectedGroup = enrollment.group_id
        ? groupById[enrollment.group_id]
        : null;
      const availableGroups = database.Groups.filter(function (group) {
        return (
          group.offering_id === offering.offering_id && isActive_(group.active)
        );
      })
        .map(function (group) {
          return Number(group.group_number);
        })
        .sort(function (a, b) {
          return a - b;
        });
      return {
        id: subject.subject_id,
        offeringId: offering.offering_id,
        externalCode: offering.external_code,
        name: subject.name,
        shortName: subject.short_name,
        color: subject.color,
        selectedGroup: selectedGroup
          ? Number(selectedGroup.group_number)
          : undefined,
        availableGroups: availableGroups,
      };
    })
    .sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });

  const lessonWeeks = {};
  database.LessonWeeks.forEach(function (row) {
    if (!lessonWeeks[row.lesson_id]) lessonWeeks[row.lesson_id] = [];
    lessonWeeks[row.lesson_id].push(Number(row.week));
  });
  const lessonGroups = {};
  database.LessonGroups.forEach(function (row) {
    if (!lessonGroups[row.lesson_id]) lessonGroups[row.lesson_id] = [];
    lessonGroups[row.lesson_id].push(row.group_id);
  });

  const lessons = database.Lessons.filter(function (lesson) {
    if (!isActive_(lesson.active)) return false;
    const offering = offeringById[lesson.offering_id];
    if (
      !offering ||
      offering.semester_id !== semester.semester_id ||
      !enrollmentByOffering[offering.offering_id]
    )
      return false;
    const restrictedGroups = lessonGroups[lesson.lesson_id] || [];
    if (!restrictedGroups.length) return true;
    const enrollment = enrollmentByOffering[lesson.offering_id];
    return Boolean(
      enrollment &&
      enrollment.group_id &&
      restrictedGroups.indexOf(enrollment.group_id) !== -1,
    );
  }).map(function (lesson) {
    const offering = offeringById[lesson.offering_id];
    const restrictedGroups = lessonGroups[lesson.lesson_id] || [];
    const enrollment = enrollmentByOffering[lesson.offering_id];
    const selectedGroup =
      enrollment && enrollment.group_id ? groupById[enrollment.group_id] : null;
    return {
      id: lesson.lesson_id,
      offeringId: offering.offering_id,
      subjectId: offering.subject_id,
      type: lesson.type,
      group:
        lesson.type === 'group' && selectedGroup
          ? Number(selectedGroup.group_number)
          : undefined,
      groups: restrictedGroups
        .filter(function (groupId) {
          const group = groupById[groupId];
          return (
            group &&
            group.offering_id === lesson.offering_id &&
            isActive_(group.active)
          );
        })
        .map(function (groupId) {
          return Number(groupById[groupId].group_number);
        })
        .sort(function (a, b) {
          return a - b;
        }),
      day: lesson.day,
      startTime: lesson.start_time,
      endTime: lesson.end_time,
      weeks: (lessonWeeks[lesson.lesson_id] || []).sort(function (a, b) {
        return a - b;
      }),
      room: lesson.room || undefined,
      format: lesson.format,
      teacher: lesson.teacher,
    };
  });

  const enrollmentsByOffering = {};
  database.Enrollments.forEach(function (row) {
    const offering = offeringById[row.offering_id];
    if (
      !isActive_(row.active) ||
      !activeUserById[row.user_id] ||
      !offering ||
      !isActive_(offering.active) ||
      offering.semester_id !== semester.semester_id
    )
      return;
    if (!enrollmentsByOffering[row.offering_id])
      enrollmentsByOffering[row.offering_id] = [];
    enrollmentsByOffering[row.offering_id].push(row);
  });
  const lessonParticipants = [];
  lessons.forEach(function (lesson) {
    const restrictedGroups = lessonGroups[lesson.id] || [];
    const userIds = Array.from(
      new Set(
        (enrollmentsByOffering[lesson.offeringId] || [])
          .filter(function (enrollment) {
            const enrollmentGroup = enrollment.group_id
              ? groupById[enrollment.group_id]
              : null;
            return (
              !restrictedGroups.length ||
              Boolean(
                enrollmentGroup &&
                enrollmentGroup.offering_id === lesson.offeringId &&
                isActive_(enrollmentGroup.active) &&
                restrictedGroups.indexOf(enrollment.group_id) !== -1,
              )
            );
          })
          .map(function (enrollment) {
            return enrollment.user_id;
          }),
      ),
    ).sort(function (a, b) {
      return activeUserById[a].display_name.localeCompare(
        activeUserById[b].display_name,
      );
    });
    lesson.weeks.forEach(function (week) {
      lessonParticipants.push({
        lessonId: lesson.id,
        week: week,
        userIds: userIds,
      });
    });
  });

  const userPreferences = getUserPreferences_(database, user.user_id);
  return {
    users: activeUsers.map(publicUser_).sort(function (a, b) {
      return a.displayName.localeCompare(b.displayName);
    }),
    user: publicUser_(user),
    semester: {
      id: semester.semester_id,
      title: semester.title,
      startDate: semester.start_date,
      weeksCount: Number(semester.weeks_count),
    },
    semesters: publicSemesters_(database),
    currentSemesterId: getCurrentSemesterId_(database),
    subjects: subjects,
    lessons: lessons,
    lessonParticipants: lessonParticipants,
    participantUserCount: activeUsers.length,
    revision: getRevisionFromDb_(database),
    preferences: userPreferences.preferences,
    preferencesRevision: userPreferences.preferencesRevision,
    preferencesExists: userPreferences.preferencesExists,
  };
}

function canonicalLessonsForOffering_(database, offeringId) {
  const groups = {};
  database.Groups.forEach(function (row) {
    groups[row.group_id] = row;
  });
  const weeks = {};
  database.LessonWeeks.forEach(function (row) {
    if (!weeks[row.lesson_id]) weeks[row.lesson_id] = [];
    weeks[row.lesson_id].push(Number(row.week));
  });
  const lessonGroupNumbers = {};
  database.LessonGroups.forEach(function (row) {
    if (!lessonGroupNumbers[row.lesson_id])
      lessonGroupNumbers[row.lesson_id] = [];
    if (groups[row.group_id])
      lessonGroupNumbers[row.lesson_id].push(
        Number(groups[row.group_id].group_number),
      );
  });

  return database.Lessons.filter(function (row) {
    return row.offering_id === offeringId && isActive_(row.active);
  })
    .map(function (row) {
      const groupNumbers = (lessonGroupNumbers[row.lesson_id] || []).sort(
        function (a, b) {
          return a - b;
        },
      );
      return {
        type: row.type,
        group:
          groupNumbers.length === 1
            ? groupNumbers[0]
            : groupNumbers.length
              ? groupNumbers
              : undefined,
        day: row.day,
        startTime: row.start_time,
        endTime: row.end_time,
        weeks: (weeks[row.lesson_id] || []).sort(function (a, b) {
          return a - b;
        }),
        room: row.room || undefined,
        format: row.format,
        teacher: row.teacher,
      };
    })
    .sort(function (a, b) {
      return JSON.stringify(a).localeCompare(JSON.stringify(b));
    });
}

function canonicalImportedLessons_(lessons) {
  return (lessons || [])
    .map(function (lesson) {
      const result = {
        type: lesson.type,
        group: lesson.group === undefined ? undefined : Number(lesson.group),
        day: lesson.day,
        startTime: lesson.startTime,
        endTime: lesson.endTime,
        weeks: Array.from(new Set(lesson.weeks.map(Number))).sort(
          function (a, b) {
            return a - b;
          },
        ),
        room: lesson.room || undefined,
        format: lesson.format,
        teacher: String(lesson.teacher).trim(),
      };
      return result;
    })
    .sort(function (a, b) {
      return JSON.stringify(a).localeCompare(JSON.stringify(b));
    });
}
